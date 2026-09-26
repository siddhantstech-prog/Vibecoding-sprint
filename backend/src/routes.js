/**
 * Route handlers. Each handler receives (ctx) where
 * ctx = { db, params, query, body, req, res }.
 *
 * Handlers return a plain object; the server serialises it as JSON with 200.
 * For a non-200 status they throw an HttpError from ./http.js.
 */

import { badRequest } from './http.js';
import { parseInteger, parsePrice, parseProductId, parseString } from './validate.js';
import {
  MOVEMENT_TYPE,
  applyStockMovement,
  getDashboardStats,
  inTransaction,
  refreshProductAlerts,
  requireProductRow,
  syncAlertsForProduct,
  toProductJson,
} from './stock.js';
import { nowIso } from './db.js';

const DEFAULT_CATEGORY = 'Uncategorized';

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

export function listProducts({ db }) {
  const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
  const products = rows.map(toProductJson);
  return { products, count: products.length };
}

export function getProduct({ db, params }) {
  const id = parseProductId(params.id);
  return { product: toProductJson(requireProductRow(db, id)) };
}

export function createProduct({ db, body }) {
  const name = parseString(body.name, 'name', { required: true, maxLength: 120 });
  const category = parseString(body.category, 'category', {
    defaultValue: DEFAULT_CATEGORY,
    maxLength: 80,
  });
  const quantity = parseInteger(body.quantity, 'quantity', {
    defaultValue: 0,
    min: 0,
    allowNull: false,
  });
  const reorderLevel = parseInteger(body.reorder_level, 'reorder_level', {
    defaultValue: 0,
    min: 0,
    allowNull: false,
  });
  const price = parsePrice(body.price, 'price', { defaultValue: 0, allowNull: false });
  const supplier = parseString(body.supplier, 'supplier', { maxLength: 120 });

  const ts = nowIso();
  const productId = inTransaction(db, () => {
    const result = db
      .prepare(
        `INSERT INTO products (name, category, quantity, reorder_level, price, supplier, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, category, quantity, reorderLevel, price, supplier, ts);

    const newId = Number(result.lastInsertRowid);

    // Opening movement so the ledger reflects the initial quantity.
    if (quantity > 0) {
      db.prepare(
        `INSERT INTO stock_movements (product_id, type, quantity, timestamp) VALUES (?, 'IN', ?, ?)`,
      ).run(newId, quantity, ts);
    }

    // A product created directly in a low/out-of-stock state must raise alerts too.
    syncAlertsForProduct(db, requireProductRow(db, newId));

    return newId;
  });

  return { product: toProductJson(requireProductRow(db, productId)) };
}

export function updateProduct({ db, params, body }) {
  const id = parseProductId(params.id);
  const existing = requireProductRow(db, id);

  // Quantity is intentionally immutable here: it may only change through
  // POST /products/:id/stock-in and /stock-out so the movement ledger stays
  // authoritative. Reject rather than silently ignore, so clients see the bug.
  if (body.quantity !== undefined) {
    throw badRequest(
      'Cannot update "quantity" directly — use POST /products/:id/stock-in or /stock-out',
    );
  }

  const name = parseString(body.name, 'name', { maxLength: 120 }) ?? existing.name;
  const category = body.category === undefined
    ? existing.category
    : parseString(body.category, 'category', { maxLength: 80 }) ?? DEFAULT_CATEGORY;
  const reorderLevel = body.reorder_level === undefined
    ? existing.reorder_level
    : parseInteger(body.reorder_level, 'reorder_level', { min: 0, allowNull: false });
  const price = body.price === undefined
    ? existing.price
    : parsePrice(body.price, 'price', { allowNull: false });
  const supplier = body.supplier === undefined
    ? existing.supplier
    : parseString(body.supplier, 'supplier', { maxLength: 120 });

  db.prepare(
    `UPDATE products
        SET name = ?, category = ?, reorder_level = ?, price = ?, supplier = ?, last_updated = ?
      WHERE id = ?`,
  ).run(name, category, reorderLevel, price, supplier, nowIso(), id);

  // reorder_level changes can flip the status -> reconcile alerts.
  return { product: refreshProductAlerts(db, id) };
}

export function deleteProduct({ db, params }) {
  const id = parseProductId(params.id);
  requireProductRow(db, id); // 404 before deleting

  // stock_movements + alerts are removed by ON DELETE CASCADE.
  db.prepare('DELETE FROM products WHERE id = ?').run(id);

  return { deleted: true, id, message: 'Product deleted' };
}

/* ------------------------------------------------------------------ *
 * Stock movements
 * ------------------------------------------------------------------ */

function movementQuantity(body) {
  return parseInteger(body.quantity, 'quantity', { min: 1, allowNull: false });
}

export function stockIn({ db, params, body }) {
  const id = parseProductId(params.id);
  const quantity = movementQuantity(body);
  return { product: applyStockMovement(db, id, MOVEMENT_TYPE.IN, quantity) };
}

export function stockOut({ db, params, body }) {
  const id = parseProductId(params.id);
  const quantity = movementQuantity(body);
  // applyStockMovement throws 400 "Insufficient stock: ..." when it would go negative.
  return { product: applyStockMovement(db, id, MOVEMENT_TYPE.OUT, quantity) };
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

function parseAlertStatusFilter(query) {
  const raw = (query.get('status') ?? 'unresolved').trim().toLowerCase();
  if (raw === 'all' || raw === 'any') return { filterAll: true, status: null };

  const normalised = raw.toUpperCase();
  if (normalised === 'UNRESOLVED' || normalised === 'RESOLVED') {
    return { filterAll: false, status: normalised };
  }
  throw badRequest('"status" must be one of: unresolved, resolved, all');
}

export function listAlerts({ db, query }) {
  const { filterAll, status } = parseAlertStatusFilter(query);

  const sql = filterAll
    ? `SELECT a.*, p.name AS product_name
         FROM alerts a JOIN products p ON p.id = a.product_id
        ORDER BY a.id DESC`
    : `SELECT a.*, p.name AS product_name
         FROM alerts a JOIN products p ON p.id = a.product_id
        WHERE a.status = ?
        ORDER BY a.id DESC`;

  const rows = filterAll ? db.prepare(sql).all() : db.prepare(sql).all(status);

  const alerts = rows.map((row) => ({
    id: row.id,
    product_id: row.product_id,
    product: { id: row.product_id, name: row.product_name },
    product_name: row.product_name,
    type: row.type,
    message: row.message,
    status: row.status,
    created_at: row.created_at,
  }));

  return { alerts, count: alerts.length, filter: filterAll ? 'all' : status };
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

export function dashboardStats({ db }) {
  return getDashboardStats(db);
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export function health({ db }) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  return { status: 'ok', products: count };
}
