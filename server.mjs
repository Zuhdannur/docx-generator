import http from 'node:http';
import { URL } from 'node:url';
import handler from './api/generate.js';

function createResponseShim(nativeRes) {
  let currentStatusCode = 200;
  const resShim = {
    setHeader(name, value) {
      nativeRes.setHeader(name, value);
    },
    status(code) {
      currentStatusCode = code;
      return resShim;
    },
    json(payload) {
      if (!nativeRes.headersSent) {
        nativeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      nativeRes.statusCode = currentStatusCode;
      nativeRes.end(JSON.stringify(payload));
    },
    send(data) {
      nativeRes.statusCode = currentStatusCode;
      if (Buffer.isBuffer(data) || typeof data === 'string') {
        nativeRes.end(data);
      } else {
        if (!nativeRes.headersSent) {
          nativeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        nativeRes.end(JSON.stringify(data));
      }
    }
  };
  return resShim;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    try {
      const resShim = createResponseShim(res);
      await handler(req, resShim);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
    return;
  }

  // Fallback for other routes
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Local server listening on http://localhost:${PORT}`);
});

