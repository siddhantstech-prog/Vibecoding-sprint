/**
 * Stock + alert domain logic.
 *
 * This module is the SINGLE SOURCE OF TRUTH for stock status. Routes never
 * compute a status themselves and never trust a status sent by the client —
 * they always go through computeStatus()/syncAlertsForProduct().
 */

import { notFound, badRequest } from './http.js';
import { nowIso } from './db.js';

export const STATUS = {
  NORMAL: 'NORMAL',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
};

export const MOVEMENT_TYPE = { IN: 'IN', OUT: 'OUT' };

/**
 * Stock status rules:
 *   OUT_OF_STOCK  quantity === 0
 *   LOW_STOCK     0 < quantity <= reorder_level
 *   NORMAL        quantity > reorder_level
 */
export function computeStatus(quantity, reorderLevel) {
  if (!Number.isFinite(quantity) || !Number.isFinite(reorderLevel)) {
    throw new Error('computeStatus requires finite numbers');
  }
  if (quantity <= 0) return STATUS.OUT_OF_STOCK;
  if (quantity <= reorderLevel) return STATUS.LOW_STOCK;
  return STATUS.NORMAL;
}

/** Maps a products row (+ status) to the JSON shape the API returns. */
export function toProductJson(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    reorder_level: row.reorder_level,
    price: row.price,
    supplier: row.supplier,
    last_updated: row.last_updated,
    status: computeStatus(row.quantity, row.reorder_level),
  };
}

export function getProductRow(db, id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) ?? null;
}

/** Fetches a product or throws a 404. */
export function requireProductRow(db, id) {
  const row = getProductRow(db, id);
  if (!row) throw notFound(`Product ${id} not found`);
  return row;
}

function buildAlertMessage(product, status) {
  if (status === STATUS.OUT_OF_STOCK) {
    return `${product.name} is out of stock (0 in stock, reorder level ${product.reorder_level})`;
  }
  return `${product.name} is low in stock (${product.quantity} left, reorder level ${product.reorder_level})`;
}

/**
 * Reconciles a product's alerts against its CURRENT status. Idempotent — safe
 * to call after every mutation.
 *
 *  1. Every UNRESOLVED alert whose type no longer matches the current status is
 *     resolved. (When status is NORMAL this resolves everything, since no NORMAL
 *     alert type exists.)
 *  2. If the status is LOW_STOCK / OUT_OF_STOCK, exactly one UNRESOLVED alert of
 *     that type is guaranteed to exist — created only when missing, never
 *     duplicated.
 */
export function syncAlertsForProduct(db, product) {
  const status = computeStatus(product.quantity, product.reorder_level);
  const ts = nowIso();

  // 1. Resolve alerts that no longer apply.
  db.prepare(
    `UPDATE alerts
        SET status = 'RESOLVED'
      WHERE product_id = ?
        AND status = 'UNRESOLVED'
        AND type <> ?`,
  ).run(product.id, status);

  // 2. Ensure exactly one UNRESOLVED alert for the active status.
  if (status !== STATUS.NORMAL) {
    db.prepare(
      `INSERT INTO alerts (product_id, type, message, status, created_at)
       SELECT ?, ?, ?, 'UNRESOLVED', ?
        WHERE NOT EXISTS (
          SELECT 1 FROM alerts
           WHERE product_id = ? AND type = ? AND status = 'UNRESOLVED'
        )`,
    ).run(product.id, status, buildAlertMessage(product, status), ts, product.id, status);
  }

  return status;
}

/** Runs a function inside an IMMEDIATE transaction, rolling back on error. */
export function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

/**
 * Applies a stock movement atomically: validate -> update quantity -> log
 * movement -> recompute status -> reconcile alerts.
 *
 * Stock can never go negative: an OUT that exceeds the available quantity is
 * rejected with 400 "Insufficient stock" before anything is written.
 *
 * @param {'IN'|'OUT'} type
 * @param {number} quantity positive integer
 */
export function applyStockMovement(db, productId, type, quantity) {
  const current = requireProductRow(db, productId);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw badRequest('"quantity" must be an integer greater than 0');
  }

  if (type === MOVEMENT_TYPE.OUT && quantity > current.quantity) {
    throw badRequest(
      `Insufficient stock: requested ${quantity}, available ${current.quantity}`,
    );
  }

  const ts = nowIso();
  const nextQuantity = type === MOVEMENT_TYPE.IN
    ? current.quantity + quantity
    : current.quantity - quantity;

  inTransaction(db, () => {
    db.prepare(
      'UPDATE products SET quantity = ?, last_updated = ? WHERE id = ?',
    ).run(nextQuantity, ts, productId);

    db.prepare(
      'INSERT INTO stock_movements (product_id, type, quantity, timestamp) VALUES (?, ?, ?, ?)',
    ).run(productId, type, quantity, ts);

    syncAlertsForProduct(db, { ...current, quantity: nextQuantity, last_updated: ts });
  });

  return toProductJson(requireProductRow(db, productId));
}

/** Recomputes status + alerts for a product after a non-quantity edit. */
export function refreshProductAlerts(db, productId) {
  const row = requireProductRow(db, productId);
  syncAlertsForProduct(db, row);
  return toProductJson(requireProductRow(db, productId));
}

/** Reconciles alerts for every product (used once after seeding). */
export function reconcileAllAlerts(db) {
  const rows = db.prepare('SELECT * FROM products').all();
  for (const row of rows) syncAlertsForProduct(db, row);
  return rows.length;
}

/**
 * Dashboard aggregates, computed with the same computeStatus() used everywhere
 * else (no duplicated SQL status logic).
 */
export function getDashboardStats(db) {
  const products = db.prepare('SELECT * FROM products').all();

  let totalQuantity = 0;
  let lowStock = 0;
  let outOfStock = 0;
  for (const row of products) {
    totalQuantity += row.quantity;
    const status = computeStatus(row.quantity, row.reorder_level);
    if (status === STATUS.LOW_STOCK) lowStock += 1;
    else if (status === STATUS.OUT_OF_STOCK) outOfStock += 1;
  }

  const { critical_alerts: criticalAlerts } = db
    .prepare(`SELECT COUNT(*) AS critical_alerts FROM alerts WHERE status = 'UNRESOLVED'`)
    .get();

  const totalProducts = products.length;

  // Key names: docs/PRD.md Section 14 is the primary (frozen) contract.
  // The PROJECT_SPEC Section 12 aliases are emitted alongside so either
  // frontend naming convention works. See backend/README.md + final report.
  return {
    total_products: totalProducts,
    total_quantity: totalQuantity,
    low_stock_count: lowStock,
    out_of_stock_count: outOfStock,
    critical_alerts: criticalAlerts,

    // PROJECT_SPEC Section 12 aliases
    total_inventory: totalQuantity,
    low_stock: lowStock,
    out_of_stock: outOfStock,
  };
}
