/**
 * Database layer tests.
 *
 * The API tests in api.test.mjs prove the HTTP behaviour; these tests prove the
 * guarantees that live in the SCHEMA itself, by talking to SQLite directly:
 * constraints, foreign keys, cascades, indexes, migrations, seed data and
 * on-disk persistence.
 *
 *   npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SCHEMA_VERSION,
  SEED_PRODUCTS,
  describeSchema,
  migrate,
  openDatabase,
  seedDatabase,
  seedIfEmpty,
  verifySchema,
  withTransaction,
} from '../src/db.js';
import { reconcileAllAlerts, syncAlertsForProduct } from '../src/stock.js';

const tmp = (name) => join(tmpdir(), `inv-db-${name}-${process.pid}-${Date.now()}.db`);
const cleanup = (...paths) => {
  for (const path of paths) {
    for (const suffix of ['', '-shm', '-wal']) {
      rmSync(`${path}${suffix}`, { force: true });
    }
  }
};

const NOW = () => new Date().toISOString();

/** Inserts a product, returning its id. */
function insertProduct(db, overrides = {}) {
  const row = {
    name: 'Widget',
    category: 'Tools',
    quantity: 5,
    reorder_level: 2,
    price: 9.99,
    supplier: 'Widget Co',
    ...overrides,
  };
  const result = db
    .prepare(
      `INSERT INTO products (name, category, quantity, reorder_level, price, supplier, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.name, row.category, row.quantity, row.reorder_level, row.price, row.supplier, NOW());
  return Number(result.lastInsertRowid);
}

/* ------------------------------------------------------------------ *
 * 1. Schema shape
 * ------------------------------------------------------------------ */

describe('schema', () => {
  test('creates the three tables with the documented columns', () => {
    const db = openDatabase(':memory:');
    const { schema } = verifySchema(db);
    assert.deepEqual(schema.tables.products.columns, [
      'id', 'name', 'category', 'quantity', 'reorder_level', 'price',
      'supplier', 'last_updated',
    ]);
    assert.deepEqual(schema.tables.stock_movements.columns, [
      'id', 'product_id', 'type', 'quantity', 'timestamp',
    ]);
    assert.deepEqual(schema.tables.alerts.columns, [
      'id', 'product_id', 'type', 'message', 'status', 'created_at',
    ]);
    db.close();
  });

  test('verifySchema reports OK on a fresh database', () => {
    const db = openDatabase(':memory:');
    const report = verifySchema(db);
    assert.deepEqual(report.problems, []);
    assert.equal(report.ok, true);
    assert.equal(report.schema.userVersion, SCHEMA_VERSION);
    assert.equal(report.schema.foreignKeys, true);
    assert.deepEqual(report.schema.integrityCheck, ['ok']);
    assert.equal(report.schema.foreignKeyViolations, 0);
    db.close();
  });

  test('all expected indexes exist, including the partial unique one', () => {
    const db = openDatabase(':memory:');
    const { indexes } = describeSchema(db);
    for (const index of [
      'idx_stock_movements_product',
      'idx_alerts_product',
      'idx_alerts_status',
      'ux_alerts_unresolved',
    ]) {
      assert.ok(indexes.includes(index), `missing index ${index}`);
    }
    db.close();
  });

  test('idempotent: opening the same file twice re-applies nothing', () => {
    const path = tmp('idem');
    const first = openDatabase(path);
    seedIfEmpty(first);
    first.close();

    const second = openDatabase(path);
    assert.deepEqual(migrate(second), [], 'no migration should be pending');
    assert.equal(verifySchema(second).ok, true);
    assert.equal(
      second.prepare('SELECT COUNT(*) AS c FROM products').get().c,
      SEED_PRODUCTS.length,
    );
    second.close();
    cleanup(path);
  });

  test('migrates a legacy v1 database in place, keeping every row', () => {
    const path = tmp('legacy');
    // Recreate the exact pre-migration (commit 6eff27d) schema, with data in it.
    const legacy = openDatabase(path);
    legacy.exec('DROP TABLE stock_movements; DROP TABLE alerts; DROP TABLE products;');
    legacy.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
        price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
        supplier TEXT, last_updated TEXT NOT NULL);
      CREATE TABLE stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
        quantity INTEGER NOT NULL CHECK (quantity > 0), timestamp TEXT NOT NULL);
      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('LOW_STOCK', 'OUT_OF_STOCK')),
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNRESOLVED' CHECK (status IN ('UNRESOLVED', 'RESOLVED')),
        created_at TEXT NOT NULL);
    `);
    legacy.exec('DROP INDEX IF EXISTS idx_stock_movements_product');
    legacy.exec('DROP INDEX IF EXISTS idx_alerts_product');
    legacy.exec('DROP INDEX IF EXISTS idx_alerts_status');
    legacy.exec('PRAGMA user_version = 0');

    const id = insertProduct(legacy, { name: 'Legacy Item', quantity: 7, reorder_level: 2 });
    legacy
      .prepare("INSERT INTO stock_movements (product_id,type,quantity,timestamp) VALUES (?,'IN',7,?)")
      .run(id, NOW());
    legacy
      .prepare("INSERT INTO alerts (product_id,type,message,status,created_at) VALUES (?,'LOW_STOCK','m','UNRESOLVED',?)")
      .run(id, NOW());
    // A duplicate UNRESOLVED alert that the old schema allowed.
    legacy
      .prepare("INSERT INTO alerts (product_id,type,message,status,created_at) VALUES (?,'LOW_STOCK','m2','UNRESOLVED',?)")
      .run(id, NOW());
    legacy.close();

    // Re-opening runs the migrations.
    const upgraded = openDatabase(path);
    const report = verifySchema(upgraded);
    assert.equal(report.ok, true, `problems: ${report.problems.join('; ')}`);
    assert.equal(report.schema.userVersion, SCHEMA_VERSION);

    const product = upgraded.prepare('SELECT * FROM products WHERE id = ?').get(id);
    assert.equal(product.name, 'Legacy Item');
    assert.equal(product.quantity, 7);
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c, 1);
    assert.equal(upgraded.prepare('SELECT COUNT(*) AS c FROM alerts').get().c, 2, 'history preserved');

    // The duplicate was demoted, not deleted.
    const unresolved = upgraded
      .prepare("SELECT COUNT(*) AS c FROM alerts WHERE status = 'UNRESOLVED'")
      .get().c;
    assert.equal(unresolved, 1);

    // New constraint now applies.
    assert.throws(
      () => insertProduct(upgraded, { name: 'Fractional', quantity: 1.5 }),
      /CHECK constraint failed/,
    );
    upgraded.close();
    cleanup(path);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Check constraints
 * ------------------------------------------------------------------ */

describe('check constraints', () => {
  const db = openDatabase(':memory:');

  test('products.quantity cannot be negative', () => {
    assert.throws(() => insertProduct(db, { name: 'Neg', quantity: -1 }), /quantity >= 0/);
  });

  test('products.reorder_level cannot be negative', () => {
    assert.throws(() => insertProduct(db, { name: 'Neg', reorder_level: -1 }), /reorder_level >= 0/);
  });

  test('products.price cannot be negative', () => {
    assert.throws(() => insertProduct(db, { name: 'Neg', price: -0.01 }), /price >= 0/);
  });

  test('quantities must be whole units (no fractional stock)', () => {
    assert.throws(() => insertProduct(db, { name: 'Half', quantity: 1.5 }), /typeof\(quantity\)/);
    assert.throws(() => insertProduct(db, { name: 'Half', reorder_level: 2.5 }), /typeof\(reorder_level\)/);
    // A whole number written as 5.0 is still fine.
    assert.doesNotThrow(() => insertProduct(db, { name: 'Whole', quantity: 5, reorder_level: 1 }));
  });

  test('required product columns are NOT NULL', () => {
    assert.throws(
      () => db.prepare('INSERT INTO products (name, quantity, reorder_level, price, last_updated) VALUES (NULL,1,0,0,?)').run(NOW()),
      /NOT NULL/,
    );
    assert.throws(
      () => db.prepare('INSERT INTO products (name, quantity, reorder_level, price, last_updated) VALUES (?,NULL,0,0,?)').run('x', NOW()),
      /NOT NULL/,
    );
    assert.throws(
      () => db.prepare('INSERT INTO products (name, quantity, reorder_level, price, last_updated) VALUES (?,1,0,0,NULL)').run('x'),
      /NOT NULL/,
    );
  });

  test('stock_movements.quantity must be greater than zero', () => {
    const id = insertProduct(db, { name: 'Mover', quantity: 5 });
    const insert = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, timestamp) VALUES (?, 'IN', ?, ?)",
    );
    assert.throws(() => insert.run(id, 0, NOW()), /quantity > 0/);
    assert.throws(() => insert.run(id, -3, NOW()), /quantity > 0/);
    assert.doesNotThrow(() => insert.run(id, 1, NOW()));
  });

  test('stock_movements.type must be IN or OUT', () => {
    const id = insertProduct(db, { name: 'Typed', quantity: 5 });
    const insert = db.prepare(
      'INSERT INTO stock_movements (product_id, type, quantity, timestamp) VALUES (?, ?, 1, ?)',
    );
    for (const type of ['in', 'out', 'SIDEWAYS', '', 'IN OUT']) {
      assert.throws(() => insert.run(id, type, NOW()), /type IN \('IN', 'OUT'\)/, `type ${type}`);
    }
    assert.doesNotThrow(() => insert.run(id, 'IN', NOW()));
    assert.doesNotThrow(() => insert.run(id, 'OUT', NOW()));
  });

  test('alerts.type must be LOW_STOCK or OUT_OF_STOCK', () => {
    const id = insertProduct(db, { name: 'Alerted', quantity: 0 });
    const insert = db.prepare(
      "INSERT INTO alerts (product_id, type, message, status, created_at) VALUES (?, ?, 'm', 'UNRESOLVED', ?)",
    );
    for (const type of ['low_stock', 'CRITICAL', 'NORMAL', '']) {
      assert.throws(() => insert.run(id, type, NOW()), /type IN \('LOW_STOCK', 'OUT_OF_STOCK'\)/, `type ${type}`);
    }
  });

  test('alerts.status must be UNRESOLVED or RESOLVED', () => {
    const id = insertProduct(db, { name: 'Alerted2', quantity: 0 });
    const insert = db.prepare(
      "INSERT INTO alerts (product_id, type, message, status, created_at) VALUES (?, 'OUT_OF_STOCK', 'm', ?, ?)",
    );
    for (const status of ['PENDING', 'open', 'CLOSED', '']) {
      assert.throws(() => insert.run(id, status, NOW()), /status IN \('UNRESOLVED', 'RESOLVED'\)/, `status ${status}`);
    }
    assert.doesNotThrow(() => insert.run(id, 'UNRESOLVED', NOW()));
    assert.doesNotThrow(() => insert.run(id, 'RESOLVED', NOW()));
  });

  test('only one UNRESOLVED alert per product+type, but history is unlimited', () => {
    const id = insertProduct(db, { name: 'Unique', quantity: 0 });
    const insert = db.prepare(
      "INSERT INTO alerts (product_id, type, message, status, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run(id, 'OUT_OF_STOCK', 'first', 'UNRESOLVED', NOW());
    assert.throws(
      () => insert.run(id, 'OUT_OF_STOCK', 'dup', 'UNRESOLVED', NOW()),
      /UNIQUE constraint failed/,
    );
    // Different type for the same product is still fine.
    assert.doesNotThrow(() => insert.run(id, 'LOW_STOCK', 'other', 'UNRESOLVED', NOW()));
    // Resolved history rows never conflict.
    assert.doesNotThrow(() => insert.run(id, 'OUT_OF_STOCK', 'hist1', 'RESOLVED', NOW()));
    assert.doesNotThrow(() => insert.run(id, 'OUT_OF_STOCK', 'hist2', 'RESOLVED', NOW()));
    // ...and once the active one is resolved a new active one can be raised.
    db.prepare("UPDATE alerts SET status = 'RESOLVED' WHERE product_id = ? AND type = 'OUT_OF_STOCK' AND status = 'UNRESOLVED'").run(id);
    assert.doesNotThrow(() => insert.run(id, 'OUT_OF_STOCK', 'reopened', 'UNRESOLVED', NOW()));
  });
});

/* ------------------------------------------------------------------ *
 * 3. Foreign keys + cascade
 * ------------------------------------------------------------------ */

describe('foreign keys and cascades', () => {
  const db = openDatabase(':memory:');

  test('foreign key enforcement is on for the connection', () => {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  });

  test('a movement cannot reference a missing product', () => {
    assert.throws(
      () => db.prepare("INSERT INTO stock_movements (product_id,type,quantity,timestamp) VALUES (999999,'IN',1,?)").run(NOW()),
      /FOREIGN KEY constraint failed/,
    );
  });

  test('an alert cannot reference a missing product', () => {
    assert.throws(
      () => db.prepare("INSERT INTO alerts (product_id,type,message,status,created_at) VALUES (999999,'LOW_STOCK','m','UNRESOLVED',?)").run(NOW()),
      /FOREIGN KEY constraint failed/,
    );
  });

  test('deleting a product cascades to its movements and alerts', () => {
    const id = insertProduct(db, { name: 'Doomed', quantity: 4, reorder_level: 9 });
    db.prepare("INSERT INTO stock_movements (product_id,type,quantity,timestamp) VALUES (?,'IN',4,?)").run(id, NOW());
    db.prepare("INSERT INTO stock_movements (product_id,type,quantity,timestamp) VALUES (?,'OUT',1,?)").run(id, NOW());
    db.prepare("INSERT INTO alerts (product_id,type,message,status,created_at) VALUES (?,'LOW_STOCK','m','UNRESOLVED',?)").run(id, NOW());
    db.prepare("INSERT INTO alerts (product_id,type,message,status,created_at) VALUES (?,'OUT_OF_STOCK','m','RESOLVED',?)").run(id, NOW());

    db.prepare('DELETE FROM products WHERE id = ?').run(id);

    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?').get(id).c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE product_id = ?').get(id).c, 0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  });

  test('foreign_key_check finds nothing on a healthy database', () => {
    assert.equal(describeSchema(db).foreignKeyViolations, 0);
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check), ['ok']);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Transactions
 * ------------------------------------------------------------------ */

describe('transactions', () => {
  test('rolls everything back when the body throws', () => {
    const db = openDatabase(':memory:');
    assert.throws(
      () => withTransaction(db, () => {
        insertProduct(db, { name: 'Ghost' });
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM products').get().c, 0);
    db.close();
  });

  test('commits and returns the body result', () => {
    const db = openDatabase(':memory:');
    const id = withTransaction(db, () => insertProduct(db, { name: 'Keeper' }));
    assert.ok(id > 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM products').get().c, 1);
    db.close();
  });

  test('a failed seed leaves no partial rows', () => {
    const db = openDatabase(':memory:');
    const original = SEED_PRODUCTS.length;
    const broken = SEED_PRODUCTS.map((p, i) => (i === 2 ? { ...p, quantity: -1 } : p));
    const originalSeed = SEED_PRODUCTS.splice(0, original, ...broken);
    try {
      assert.throws(() => seedDatabase(db), /CHECK constraint failed/);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM products').get().c, 0);
    } finally {
      SEED_PRODUCTS.splice(0, original, ...originalSeed);
    }
    db.close();
  });

  test('nested withTransaction joins the outer transaction', () => {
    const db = openDatabase(':memory:');
    withTransaction(db, () => {
      withTransaction(db, () => insertProduct(db, { name: 'Nested' }));
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM products').get().c, 1);
      assert.equal(db.isTransaction, true, 'inner call must not commit early');
    });
    assert.equal(db.isTransaction, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM products').get().c, 1);
    db.close();
  });
});

/* ------------------------------------------------------------------ *
 * 5. Seed data
 * ------------------------------------------------------------------ */

describe('seed data', () => {
  test('seeds exactly the five documented demo products', () => {
    const db = openDatabase(':memory:');
    assert.equal(seedIfEmpty(db), SEED_PRODUCTS.length);
    const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.map((r) => [r.name, r.quantity, r.reorder_level]),
      [
        ['Coffee', 10, 3],
        ['Rice', 25, 5],
        ['Milk', 4, 6],
        ['Sugar', 0, 2],
        ['Tea', 8, 2],
      ],
    );
    for (const row of rows) {
      assert.ok(row.price > 0);
      assert.ok(row.supplier);
      assert.ok(row.last_updated, 'last_updated must be set');
    }
  });

  test('each seeded product with stock has an opening IN movement', () => {
    const db = openDatabase(':memory:');
    seedIfEmpty(db);
    const movements = db.prepare('SELECT * FROM stock_movements ORDER BY id').all();
    assert.equal(movements.length, 4, 'Sugar has 0 stock, so no opening movement');
    for (const m of movements) {
      assert.equal(m.type, 'IN');
      assert.ok(m.quantity > 0);
      assert.ok(m.timestamp);
    }
    const sugar = db.prepare("SELECT id FROM products WHERE name = 'Sugar'").get();
    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?').get(sugar.id).c,
      0,
    );
  });

  test('seedIfEmpty is idempotent — restarting never duplicates products', () => {
    const db = openDatabase(':memory:');
    seedIfEmpty(db);
    // The server reconciles alerts right after seeding; do the same here.
    reconcileAllAlerts(db);
    const alertsBefore = db.prepare('SELECT COUNT(*) AS c FROM alerts').get().c;
    assert.equal(seedIfEmpty(db), 0);
    assert.equal(seedIfEmpty(db), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM products').get().c, 5);
    // Reconciling repeatedly is idempotent too.
    reconcileAllAlerts(db);
    reconcileAllAlerts(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM alerts').get().c, alertsBefore);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE status = 'UNRESOLVED'").get().c,
      2,
      'Milk LOW_STOCK + Sugar OUT_OF_STOCK',
    );
  });

  test('the seed product list matches the task specification', () => {
    const expected = {
      Coffee: [10, 3],
      Rice: [25, 5],
      Milk: [4, 6],
      Sugar: [0, 2],
      Tea: [8, 2],
    };
    const actual = Object.fromEntries(
      SEED_PRODUCTS.map((p) => [p.name, [p.quantity, p.reorder_level]]),
    );
    assert.deepEqual(actual, expected);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Persistence
 * ------------------------------------------------------------------ */

describe('persistence', () => {
  test('data written by one connection is visible to the next', () => {
    const path = tmp('persist');
    const first = openDatabase(path);
    seedIfEmpty(first);
    const id = insertProduct(first, { name: 'Persisted', quantity: 12, reorder_level: 4 });
    first.prepare("INSERT INTO stock_movements (product_id,type,quantity,timestamp) VALUES (?,'IN',12,?)").run(id, NOW());
    first
      .prepare("INSERT INTO alerts (product_id,type,message,status,created_at) VALUES (?,'LOW_STOCK','persisted','UNRESOLVED',?)")
      .run(id, NOW());
    assert.equal(existsSync(path), true, 'the database file is created on disk');
    first.close();

    const second = openDatabase(path);
    const product = second.prepare('SELECT * FROM products WHERE id = ?').get(id);
    assert.equal(product.name, 'Persisted');
    assert.equal(product.quantity, 12);
    assert.equal(second.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c, 5);
    assert.equal(second.prepare('SELECT COUNT(*) AS c FROM alerts').get().c, 1);
    assert.equal(verifySchema(second).ok, true);
    second.close();
    cleanup(path);
  });

  test('auto-increment ids never collide after a migration rebuild', () => {
    const path = tmp('ids');
    const first = openDatabase(path);
    seedIfEmpty(first);
    const last = Number(first.prepare('SELECT MAX(id) AS m FROM products').get().m);
    first.close();

    const second = openDatabase(path);
    const next = insertProduct(second, { name: 'After Migration' });
    assert.ok(next > last, `expected id > ${last}, got ${next}`);
    second.close();
    cleanup(path);
  });

  test('concurrent connections agree on the schema', () => {
    const path = tmp('concurrent');
    const a = openDatabase(path);
    const b = openDatabase(path);
    assert.equal(verifySchema(a).ok, true);
    assert.equal(verifySchema(b).ok, true);
    a.close();
    b.close();
    cleanup(path);
  });
});

/* ------------------------------------------------------------------ *
 * 7. Alert flow driven through the domain layer
 * ------------------------------------------------------------------ */

describe('alert flow (stock.js over the schema)', () => {
  test('LOW_STOCK -> OUT_OF_STOCK -> NORMAL keeps exactly one active alert', () => {
    const db = openDatabase(':memory:');
    const id = insertProduct(db, { name: 'Coffee', quantity: 10, reorder_level: 3 });
    const row = () => db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    const active = () => db
      .prepare("SELECT * FROM alerts WHERE product_id = ? AND status = 'UNRESOLVED' ORDER BY id")
      .all(id);

    // NORMAL: no alert.
    syncAlertsForProduct(db, row());
    assert.equal(active().length, 0);

    // 10 -> 3: LOW_STOCK.
    db.prepare('UPDATE products SET quantity = 3 WHERE id = ?').run(id);
    syncAlertsForProduct(db, row());
    assert.equal(active().length, 1);
    assert.equal(active()[0].type, 'LOW_STOCK');

    // Still low after another movement: must not duplicate.
    db.prepare('UPDATE products SET quantity = 2 WHERE id = ?').run(id);
    syncAlertsForProduct(db, row());
    assert.equal(active().length, 1);
    assert.equal(active()[0].type, 'LOW_STOCK');

    // 3 -> 0: LOW_STOCK resolved, OUT_OF_STOCK raised, history kept.
    db.prepare('UPDATE products SET quantity = 0 WHERE id = ?').run(id);
    syncAlertsForProduct(db, row());
    assert.equal(active().length, 1);
    assert.equal(active()[0].type, 'OUT_OF_STOCK');
    const history = db.prepare('SELECT * FROM alerts WHERE product_id = ? ORDER BY id').all(id);
    assert.equal(history.length, 2);
    assert.equal(history[0].status, 'RESOLVED');
    assert.equal(history[1].status, 'UNRESOLVED');

    // Restock: everything resolves, nothing is deleted.
    db.prepare('UPDATE products SET quantity = 8 WHERE id = ?').run(id);
    syncAlertsForProduct(db, row());
    assert.equal(active().length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE product_id = ?').get(id).c, 2);
    db.close();
  });
});
