import formidable from "formidable";
import fs from "fs";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize: 5 * 1024 * 1024,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function normalizeEmptyValues(value) {
  if (value === "") return " ";
  if (value === null) return " ";
  if (Array.isArray(value)) {
    return value.map((v) => normalizeEmptyValues(v));
  }
  if (typeof value === "object" && value) {
    const result = {};
    for (const key of Object.keys(value)) {
      const normalized = normalizeEmptyValues(value[key]);
      if (normalized !== undefined) {
        result[key] = normalized;
      } else {
        // Keep explicit undefined to trigger nullGetter on missing values
        result[key] = undefined;
      }
    }
    return result;
  }
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { fields, files } = await parseForm(req);

    const dataField = fields?.data;
    const outputFileName = fields?.outputFileName;
    const templateFile = files?.template;

    if (!templateFile) {
      return res.status(400).json({ error: "Missing 'template' file" });
    }

    let dataObj = {};
    try {
      const dataString = Array.isArray(dataField) ? dataField[0] : dataField;
      dataObj = dataString ? JSON.parse(dataString) : {};
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON in 'data' field" });
    }

    const fileObj = Array.isArray(templateFile) ? templateFile[0] : templateFile;
    const filePath = fileObj?.filepath;

    if (!filePath) {
      return res.status(400).json({ error: "Unable to read uploaded file" });
    }

    const content = fs.readFileSync(filePath);
    let zip;
    try {
      zip = new PizZip(content);
    } catch (e) {
      return res.status(400).json({
        error: "Invalid DOCX template (file is not a valid .docx)",
        details: e?.message || undefined,
      });
    }

    let doc;
    try {
      doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "[[", end: "]]" },
        parser: function(tag) {
          // Keep spaces as-is in tag names
          return {
            get: function(scope) {
              return scope[tag];
            }
          };
        },
        nullGetter(part) {
          // Preserve unresolved placeholders as [[tag]]
          return `[[${part?.value ?? ""}]]`;
        },
      });
    } catch (error) {
      return res.status(400).json({
        error: "Invalid DOCX template",
        details: error?.message || undefined,
      });
    }

    try {
      const normalizedData = normalizeEmptyValues(dataObj);
      doc.render(normalizedData);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Template rendering error" });
    }

    const buf = doc.getZip().generate({ type: "nodebuffer" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    
    // Use provided filename or default to "output.docx"
    const fileName = outputFileName ? `${outputFileName}.docx` : "output.docx";
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(buf);
  } catch (error) {
    const message =
      error?.message === "maxFileSize exceeded, received" ||
      /maxFileSize/i.test(error?.message || "")
        ? "File too large (max 5MB)"
        : "Failed to process request";
    return res.status(400).json({ error: message });
  }
}

