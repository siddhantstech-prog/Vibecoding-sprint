/**
 * Tiny HTTP helpers: consistent JSON responses, a single error shape
 * ({ "error": "message" }) and the error class used across the app.
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const notFound = (message) => new HttpError(404, message);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

export function sendNoContent(res) {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

export function sendPreflight(res) {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

const MAX_BODY_BYTES = 1_000_000; // 1 MB is plenty for this API

/** Reads and parses a JSON request body. Empty body -> {}. */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(badRequest('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => reject(badRequest('Could not read request body')));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(badRequest('Request body must be a JSON object'));
        }
        resolve(parsed);
      } catch {
        reject(badRequest('Invalid JSON body'));
      }
    });
  });
}
