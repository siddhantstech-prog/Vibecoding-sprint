/**
 * Smart Inventory & Stock Alert Platform — API server.
 *
 * Zero dependencies: node:http + node:sqlite.
 *
 * Routes are mounted under BOTH `/` and `/api/` so the frontend can call
 * either `/products` or `/api/products` without a proxy change.
 */

import { createServer } from 'node:http';

import { openDatabase, seedIfEmpty } from './src/db.js';
import {
  HttpError,
  readJsonBody,
  sendJson,
  sendPreflight,
} from './src/http.js';
import { reconcileAllAlerts } from './src/stock.js';
import * as routes from './src/routes.js';

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

/**
 * [method, pattern, handler]. `:param` segments are captured into params.
 */
const ROUTES = [
  ['GET', '/health', routes.health],

  ['GET', '/products', routes.listProducts],
  ['POST', '/products', routes.createProduct],
  ['GET', '/products/:id', routes.getProduct],
  ['PUT', '/products/:id', routes.updateProduct],
  ['DELETE', '/products/:id', routes.deleteProduct],
  ['POST', '/products/:id/stock-in', routes.stockIn],
  ['POST', '/products/:id/stock-out', routes.stockOut],

  ['GET', '/alerts', routes.listAlerts],
  ['GET', '/dashboard/stats', routes.dashboardStats],
];

const COMPILED = ROUTES.map(([method, pattern, handler]) => {
  const names = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      names.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { method, regex: new RegExp(`^${source}/?$`), names, handler };
});

/** Strips a leading `/api` so both prefixes share one route table. */
function normalisePath(pathname) {
  if (pathname === '/api') return '/';
  if (pathname.startsWith('/api/')) return pathname.slice(4) || '/';
  return pathname;
}

function matchRoute(method, pathname) {
  let pathExists = false;

  for (const route of COMPILED) {
    const match = route.regex.exec(pathname);
    if (!match) continue;
    pathExists = true;
    if (route.method !== method) continue;

    const params = {};
    route.names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { handler: route.handler, params };
  }

  if (pathExists) {
    throw new HttpError(405, `Method ${method} not allowed for ${pathname}`);
  }
  throw new HttpError(404, `Route not found: ${pathname}`);
}

/** Turns unexpected internal errors into a generic 500 (never leaks internals). */
function toErrorResponse(err) {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message } };
  }
  // CHECK / FK constraint violations are our own schema guards firing.
  const message = String(err?.message || '');
  if (message.includes('CHECK constraint failed')) {
    return { status: 400, body: { error: 'Invalid data: constraint violated' } };
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return { status: 400, body: { error: 'Invalid data: referenced record does not exist' } };
  }
  console.error('[unhandled]', err);
  return { status: 500, body: { error: 'Internal server error' } };
}

export function createApp(db) {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return sendPreflight(res);

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = normalisePath(url.pathname);
      const { handler, params } = matchRoute(req.method, pathname);

      // GET/DELETE have no meaningful body, but reading is harmless & uniform.
      const body = req.method === 'GET' || req.method === 'DELETE'
        ? {}
        : await readJsonBody(req);

      const result = handler({ db, params, query: url.searchParams, body, req, res });
      return sendJson(res, 200, result);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      if (res.headersSent) return res.end();
      return sendJson(res, status, body);
    }
  });
}

export function startServer({ dbPath, port = PORT, host = HOST } = {}) {
  const db = openDatabase(dbPath);

  const seeded = seedIfEmpty(db);
  if (seeded > 0) {
    // Give the seed data a realistic alert set (Milk low, Sugar out of stock).
    reconcileAllAlerts(db);
    console.log(`[db] seeded ${seeded} demo products`);
  }

  const server = createApp(db);

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      console.log(`[api] Smart Inventory backend listening on http://localhost:${addr.port}`);
      console.log(`[api] routes mounted at "/" and "/api" — try http://localhost:${addr.port}/products`);
      resolve({ server, db, port: addr.port });
    });
  });
}

// Only auto-start when executed directly (tests import createApp/startServer).
const invokedDirectly =
  process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;

if (invokedDirectly) {
  startServer().catch((err) => {
    console.error('[fatal] failed to start server:', err);
    process.exit(1);
  });
}
