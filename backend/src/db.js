/**
 * Database layer.
 *
 * Uses Node's built-in `node:sqlite` (stable from Node 22.5+ / 24) so the
 * project has ZERO npm dependencies — nothing to install, works offline.
 *
 * The schema is the single source of truth for the data model:
 *   products         id, name, category, quantity, reorder_level, price,
 *                    supplier, last_updated
 *   stock_movements  id, product_id, type (IN|OUT), quantity, timestamp
 *   alerts           id, product_id, type (LOW_STOCK|OUT_OF_STOCK), message,
 *                    status (UNRESOLVED|RESOLVED), created_at
 *
 * Integrity rules are enforced in the schema itself (CHECK constraints +
 * ON DELETE CASCADE) so bad data cannot enter even if a code path is buggy.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = `${HERE}/../data/inventory.db`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  category      TEXT,
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  price         REAL    NOT NULL DEFAULT 0 CHECK (price >= 0),
  supplier      TEXT,
  last_updated  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('IN', 'OUT')),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  timestamp  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('LOW_STOCK', 'OUT_OF_STOCK')),
  message    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'UNRESOLVED'
                       CHECK (status IN ('UNRESOLVED', 'RESOLVED')),
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_alerts_product        ON alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status         ON alerts(status);
`;

/** Opens (and if needed creates) the database, applies pragmas + schema. */
export function openDatabase(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // foreign_keys must be enabled per connection (it is off by default).
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      /* WAL is unavailable on some filesystems; the default journal still works. */
    }
  }
  db.exec('PRAGMA busy_timeout = 5000;');

  db.exec(SCHEMA);

  return db;
}

/** ISO-8601 UTC timestamp, e.g. 2026-09-26T10:15:30.123Z */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Demo seed data. Coffee (10 / reorder 3) is the product used in the primary
 * demo walkthrough: 10 -> 3 triggers LOW_STOCK, 3 -> 0 triggers OUT_OF_STOCK.
 */
export const SEED_PRODUCTS = [
  { name: 'Coffee', category: 'Beverages', quantity: 10, reorder_level: 3, price: 12.5, supplier: 'Bean Co' },
  { name: 'Rice', category: 'Grains', quantity: 25, reorder_level: 5, price: 8.75, supplier: 'Grain Co' },
  { name: 'Milk', category: 'Dairy', quantity: 4, reorder_level: 6, price: 3.25, supplier: 'Dairy Co' },
  { name: 'Sugar', category: 'Grains', quantity: 0, reorder_level: 2, price: 2.1, supplier: 'Sweet Co' },
  { name: 'Tea', category: 'Beverages', quantity: 8, reorder_level: 2, price: 6.4, supplier: 'Leaf Co' },
];

/** Inserts seed products + opens a matching stock_in movement for each. */
export function seedDatabase(db) {
  const insertProduct = db.prepare(
    `INSERT INTO products (name, category, quantity, reorder_level, price, supplier, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, type, quantity, timestamp)
     VALUES (?, 'IN', ?, ?)`,
  );

  const ts = nowIso();
  for (const p of SEED_PRODUCTS) {
    const result = insertProduct.run(
      p.name, p.category, p.quantity, p.reorder_level, p.price, p.supplier, ts,
    );
    if (p.quantity > 0) {
      insertMovement.run(Number(result.lastInsertRowid), p.quantity, ts);
    }
  }
  return SEED_PRODUCTS.length;
}

/** Seeds only when the products table is empty (so restarts are idempotent). */
export function seedIfEmpty(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count > 0) return 0;
  return seedDatabase(db);
}
