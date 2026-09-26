/**
 * Database layer.
 *
 * Uses Node's built-in `node:sqlite` (stable from Node 22.5+ / 24) so the
 * project has ZERO npm dependencies — nothing to install, works offline.
 *
 * THE SCHEMA LIVES HERE AND ONLY HERE. There is no .sql file and no second
 * definition to drift out of sync — `openDatabase()` applies `MIGRATIONS` to a
 * freshly opened file, so every database (brand new, or created by an older
 * commit) converges on the same shape.
 *
 * Data model:
 *   products         id, name, category, quantity, reorder_level, price,
 *                    supplier, last_updated
 *   stock_movements  id, product_id, type (IN|OUT), quantity, timestamp
 *   alerts           id, product_id, type (LOW_STOCK|OUT_OF_STOCK), message,
 *                    status (UNRESOLVED|RESOLVED), created_at
 *
 * WHAT THE DATABASE ENFORCES (and nothing more):
 *   - referential integrity: FKs to products(id), ON DELETE CASCADE, so no
 *     orphaned movements/alerts can survive a product deletion
 *   - value integrity:  quantity/reorder_level/price >= 0, quantities are whole
 *     units, movement quantity > 0, movement type IN ('IN','OUT'), alert type
 *     in ('LOW_STOCK','OUT_OF_STOCK'), alert status in ('UNRESOLVED','RESOLVED')
 *   - one active alert per (product, type): a partial UNIQUE index
 *   - atomicity: multi-statement writes (seeding, stock movements) run inside a
 *     transaction
 *
 * WHAT THE DATABASE DELIBERATELY DOES NOT DO:
 *   Stock status (NORMAL / LOW_STOCK / OUT_OF_STOCK) and alert generation are
 *   business logic and stay in src/stock.js. There is deliberately no status
 *   column, no status view and no trigger here, so the backend remains the only
 *   implementation of those rules.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = `${HERE}/../data/inventory.db`;

/* ------------------------------------------------------------------ *
 * Transactions
 * ------------------------------------------------------------------ */

const txDepth = new WeakMap();

/**
 * Runs `fn` inside an IMMEDIATE transaction, committing on success and rolling
 * back on any throw. Re-entrant: a nested call joins the outer transaction
 * instead of starting (or prematurely committing) a second one.
 */
export function withTransaction(db, fn) {
  const depth = txDepth.get(db) ?? 0;
  if (depth > 0) {
    txDepth.set(db, depth + 1);
    try {
      return fn();
    } finally {
      txDepth.set(db, depth);
    }
  }

  db.exec('BEGIN IMMEDIATE');
  txDepth.set(db, 1);
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
  } finally {
    txDepth.delete(db);
  }
}

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

/**
 * FROZEN — the schema shipped in commit 6eff27d. Never edit a migration that
 * has already run; add a new one instead. New databases replay this from
 * scratch, so it must stay byte-compatible with databases already in the wild.
 */
const MIGRATION_1 = `
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

/** products DDL for migration 2 — whole-unit stock + a rebuildable temp name. */
const productsDdlV2 = (table) => `
CREATE TABLE ${table} (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  category      TEXT,
  quantity      INTEGER NOT NULL DEFAULT 0
                    CHECK (quantity >= 0)
                    CHECK (typeof(quantity) = 'integer'),
  reorder_level INTEGER NOT NULL DEFAULT 0
                    CHECK (reorder_level >= 0)
                    CHECK (typeof(reorder_level) = 'integer'),
  price         REAL    NOT NULL DEFAULT 0 CHECK (price >= 0),
  supplier      TEXT,
  last_updated  TEXT    NOT NULL
)`;

/**
 * Rebuilds `products` with the v2 constraints using SQLite's documented table
 * rebuild: create -> copy -> drop -> rename. Foreign keys are switched off for
 * the duration so dropping the old table does not cascade into
 * stock_movements/alerts; their rows keep pointing at the restored table name.
 */
function rebuildProductsWithIntegerConstraints(db) {
  db.exec(productsDdlV2('products_v2'));
  db.exec(`INSERT INTO products_v2
              (id, name, category, quantity, reorder_level, price, supplier, last_updated)
           SELECT id, name, category, quantity, reorder_level, price, supplier, last_updated
             FROM products`);
  db.exec('DROP TABLE products');
  db.exec('ALTER TABLE products_v2 RENAME TO products');
}

/**
 * Keeps alert history, but demotes any accidental duplicate UNRESOLVED rows for
 * the same (product_id, type) so the partial unique index can be created. The
 * oldest row per group stays active — the one src/stock.js would have kept.
 */
function dedupeUnresolvedAlerts(db) {
  return db
    .prepare(
      `UPDATE alerts
          SET status = 'RESOLVED'
        WHERE status = 'UNRESOLVED'
          AND id NOT IN (
            SELECT MIN(id) FROM alerts
             WHERE status = 'UNRESOLVED'
             GROUP BY product_id, type
          )`,
    )
    .run().changes;
}

const MIGRATION_2 = {
  name: 'integer stock integrity + one unresolved alert per product/type',
  up(db) {
    // PRAGMA foreign_keys is a no-op inside a transaction, so the rebuild below
    // toggles it around the transaction (see migrate()).
    rebuildProductsWithIntegerConstraints(db);
    dedupeUnresolvedAlerts(db);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_alerts_unresolved
          ON alerts(product_id, type) WHERE status = 'UNRESOLVED'`,
    );
  },
};

const MIGRATIONS = [
  { version: 1, up: (db) => db.exec(MIGRATION_1) },
  { version: 2, up: (db) => withTransaction(db, () => MIGRATION_2.up(db)) },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Applies every migration newer than the file's `PRAGMA user_version`. */
export function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  const applied = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;

    // A table rebuild must run with FK enforcement off (see MIGRATION_2).
    const needsRebuild = migration.version > 1;
    if (needsRebuild) db.exec('PRAGMA foreign_keys = OFF');
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      applied.push(migration.version);
    } catch (err) {
      if (needsRebuild) {
        try {
          db.exec('PRAGMA foreign_keys = ON');
        } catch {
          /* noop */
        }
      }
      throw new Error(
        `Database migration to v${migration.version} failed: ${err?.message ?? err}`,
        { cause: err },
      );
    } finally {
      if (needsRebuild) db.exec('PRAGMA foreign_keys = ON');
    }
  }

  return applied;
}

/* ------------------------------------------------------------------ *
 * Connection
 * ------------------------------------------------------------------ */

/** Opens (and if needed creates) the database, applies pragmas + migrations. */
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

  migrate(db);

  return db;
}

/** ISO-8601 UTC timestamp, e.g. 2026-09-26T10:15:30.123Z */
export function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ *
 * Introspection / verification
 * ------------------------------------------------------------------ */

const EXPECTED = {
  products: [
    'id', 'name', 'category', 'quantity', 'reorder_level', 'price',
    'supplier', 'last_updated',
  ],
  stock_movements: ['id', 'product_id', 'type', 'quantity', 'timestamp'],
  alerts: ['id', 'product_id', 'type', 'message', 'status', 'created_at'],
};

/** Snapshot of the live schema — used by `npm run db:check` and the tests. */
export function describeSchema(db) {
  const objects = db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    )
    .all();

  const tables = {};
  for (const name of Object.keys(EXPECTED)) {
    tables[name] = {
      columns: db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name),
      rowCount: db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c,
      sql: objects.find((o) => o.type === 'table' && o.name === name)?.sql ?? null,
    };
  }

  return {
    userVersion: db.prepare('PRAGMA user_version').get().user_version,
    foreignKeys: db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1,
    integrityCheck: db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check),
    foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all().length,
    tables,
    indexes: objects.filter((o) => o.type === 'index').map((o) => o.name),
  };
}

/**
 * Confirms the database really is at the expected version with the expected
 * tables, columns, indexes and constraint guarantees. Returns a report; never
 * throws, so callers decide how loud to be.
 */
export function verifySchema(db) {
  const schema = describeSchema(db);
  const problems = [];

  if (schema.userVersion !== SCHEMA_VERSION) {
    problems.push(
      `schema version is ${schema.userVersion}, expected ${SCHEMA_VERSION}`,
    );
  }
  if (!schema.foreignKeys) {
    problems.push('PRAGMA foreign_keys is OFF — cascade deletes would not fire');
  }
  for (const result of schema.integrityCheck) {
    if (result !== 'ok') problems.push(`integrity_check: ${result}`);
  }
  if (schema.foreignKeyViolations > 0) {
    problems.push(`${schema.foreignKeyViolations} orphaned dependent row(s)`);
  }
  for (const [table, columns] of Object.entries(EXPECTED)) {
    const actual = schema.tables[table]?.columns;
    if (!actual) {
      problems.push(`missing table "${table}"`);
      continue;
    }
    const missing = columns.filter((c) => !actual.includes(c));
    if (missing.length > 0) {
      problems.push(`table "${table}" is missing column(s): ${missing.join(', ')}`);
    }
  }
  for (const index of [
    'idx_stock_movements_product',
    'idx_alerts_product',
    'idx_alerts_status',
    'ux_alerts_unresolved',
  ]) {
    if (!schema.indexes.includes(index)) problems.push(`missing index "${index}"`);
  }

  return { ok: problems.length === 0, problems, schema };
}

/* ------------------------------------------------------------------ *
 * Seed data
 * ------------------------------------------------------------------ */

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

/**
 * Inserts seed products + opens a matching stock_in movement for each. Runs in
 * one transaction, so a mid-way failure leaves no half-seeded database.
 */
export function seedDatabase(db) {
  return withTransaction(db, () => {
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
  });
}

/** Seeds only when the products table is empty (so restarts are idempotent). */
export function seedIfEmpty(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count > 0) return 0;
  return seedDatabase(db);
}
