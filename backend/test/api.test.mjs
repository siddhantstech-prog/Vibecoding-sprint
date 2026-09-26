/**
 * End-to-end API tests. Boots the real server against a throwaway SQLite file
 * and exercises every endpoint over HTTP.
 *
 *   npm test
 *
 * Uses the built-in node:test runner — no test framework to install.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../server.js';

const DB_PATH = join(tmpdir(), `inventory-test-${process.pid}-${Date.now()}.db`);

let baseUrl;
let server;
let db;

/* ----------------------------- helpers ----------------------------- */

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b);
const put = (p, b) => api('PUT', p, b);
const del = (p) => api('DELETE', p);

/** Fetches the Coffee product row straight from GET /products. */
const coffee = () => get('/products').then((r) => r.body.products.find((p) => p.name === 'Coffee'));

/* ----------------------------- lifecycle ----------------------------- */

before(async () => {
  const started = await startServer({ dbPath: DB_PATH, port: 0, host: '127.0.0.1' });
  server = started.server;
  db = started.db;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { rmSync(`${DB_PATH}${suffix}`, { force: true }); } catch { /* noop */ }
  }
});

/* ----------------------------- 1. create ----------------------------- */

test('1. POST /products creates a product', async () => {
  const res = await post('/products', {
    name: 'Test Widget',
    category: 'Tools',
    quantity: 20,
    reorder_level: 5,
    price: 9.99,
    supplier: 'Widget Co',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.name, 'Test Widget');
  assert.equal(res.body.product.quantity, 20);
  assert.equal(res.body.product.reorder_level, 5);
  assert.equal(res.body.product.status, 'NORMAL');
  assert.ok(res.body.product.id > 0);
  assert.ok(res.body.product.last_updated);
});

test('1b. POST /products rejects invalid data', async () => {
  const noName = await post('/products', { category: 'x' });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error, /name/);

  const negQty = await post('/products', { name: 'Bad', quantity: -1 });
  assert.equal(negQty.status, 400);

  const negReorder = await post('/products', { name: 'Bad', reorder_level: -5 });
  assert.equal(negReorder.status, 400);

  const floatQty = await post('/products', { name: 'Bad', quantity: 1.5 });
  assert.equal(floatQty.status, 400);
});

/* ----------------------------- 2. list + status ----------------------------- */

test('2. GET /products returns every product with a computed status', async () => {
  const res = await get('/products');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.products));
  assert.equal(res.body.products.length, 6); // 5 seeded + 1 created in test 1
  for (const p of res.body.products) {
    assert.ok(['NORMAL', 'LOW_STOCK', 'OUT_OF_STOCK'].includes(p.status));
    // status must agree with the documented rules
    const expected = p.quantity === 0 ? 'OUT_OF_STOCK'
      : p.quantity <= p.reorder_level ? 'LOW_STOCK'
      : 'NORMAL';
    assert.equal(p.status, expected);
  }
  const byName = Object.fromEntries(res.body.products.map((p) => [p.name, p]));
  assert.equal(byName.Coffee.status, 'NORMAL');
  assert.equal(byName.Milk.status, 'LOW_STOCK');   // 4 <= 6
  assert.equal(byName.Sugar.status, 'OUT_OF_STOCK'); // 0
});

test('2b. /api prefix is supported', async () => {
  const res = await get('/api/products');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.products));
});

/* ----------------------------- 3. update ----------------------------- */

test('3. PUT /products/:id updates editable fields', async () => {
  const { body: created } = await post('/products', { name: 'Temp', quantity: 5, reorder_level: 2 });
  const res = await put(`/products/${created.product.id}`, {
    name: 'Temp Updated',
    category: 'Renamed',
    price: 19.5,
    supplier: 'New Supplier',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.name, 'Temp Updated');
  assert.equal(res.body.product.category, 'Renamed');
  assert.equal(res.body.product.price, 19.5);
  assert.equal(res.body.product.supplier, 'New Supplier');
  assert.equal(res.body.product.quantity, 5); // unchanged
});

test('3b. PUT /products/:id rejects quantity changes', async () => {
  const { body: created } = await post('/products', { name: 'Qty Guard', quantity: 5 });
  const res = await put(`/products/${created.product.id}`, { quantity: 100 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /stock-in|stock-out/i);

  const still = await get(`/products/${created.product.id}`);
  assert.equal(still.body.product.quantity, 5);
});

test('3c. PUT rejects invalid reorder_level', async () => {
  const c = await coffee();
  const res = await put(`/products/${c.id}`, { reorder_level: -1 });
  assert.equal(res.status, 400);
});

/* ----------------------------- 4. delete + 404 ----------------------------- */

test('4. DELETE /products/:id deletes, then 404s', async () => {
  const { body: created } = await post('/products', { name: 'Doomed' });
  const id = created.product.id;

  const del1 = await del(`/products/${id}`);
  assert.equal(del1.status, 200);
  assert.equal(del1.body.deleted, true);

  const del2 = await del(`/products/${id}`);
  assert.equal(del2.status, 404);
  assert.match(del2.body.error, /not found/i);

  const getAfter = await get(`/products/${id}`);
  assert.equal(getAfter.status, 404);
});

test('4b. missing product and invalid id formats', async () => {
  assert.equal((await get('/products/999999')).status, 404);
  assert.equal((await del('/products/999999')).status, 404);
  assert.equal((await put('/products/999999', { name: 'x' })).status, 404);
  assert.equal((await post('/products/999999/stock-in', { quantity: 1 })).status, 404);

  for (const badId of ['abc', '1.5', '-1', '12abc', '%20']) {
    const res = await get(`/products/${badId}`);
    assert.ok([400, 404].includes(res.status), `expected 400/404 for id "${badId}", got ${res.status}`);
    if (res.status === 400) assert.match(res.body.error, /invalid product id/i);
  }
});

/* ----------------------------- 5. stock in ----------------------------- */

test('5. POST stock-in increases stock and logs a movement', async () => {
  const before = await coffee();
  const res = await post(`/products/${before.id}/stock-in`, { quantity: 15 });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.quantity, 25);
  assert.equal(res.body.product.status, 'NORMAL');

  const movements = db
    .prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id')
    .all(before.id);
  assert.ok(movements.length >= 2);
  assert.equal(movements.at(-1).type, 'IN');
  assert.equal(movements.at(-1).quantity, 15);
});

test('5b. stock-in validates quantity', async () => {
  const c = await coffee();
  for (const qty of [0, -5, 1.5, 'abc', null]) {
    const res = await post(`/products/${c.id}/stock-in`, { quantity: qty });
    assert.equal(res.status, 400, `quantity ${JSON.stringify(qty)} should be rejected`);
  }
  const unchanged = await get(`/products/${c.id}`);
  assert.equal(unchanged.body.product.quantity, c.quantity);
});

/* ----------------------------- 6. stock out ----------------------------- */

test('6. POST stock-out decreases stock', async () => {
  const before = await coffee();
  const res = await post(`/products/${before.id}/stock-out`, { quantity: 5 });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.quantity, before.quantity - 5);
  assert.equal(res.body.product.status, 'NORMAL');
});

/* ----------------------------- 7. insufficient stock ----------------------------- */

test('7. stock-out beyond available stock is rejected with 400', async () => {
  const { body: created } = await post('/products', { name: 'Scarse', quantity: 3, reorder_level: 1 });
  const id = created.product.id;

  const res = await post(`/products/${id}/stock-out`, { quantity: 4 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /insufficient stock/i);

  // stock must be untouched, and no movement logged
  const after = await get(`/products/${id}`);
  assert.equal(after.body.product.quantity, 3);
  const movements = db
    .prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?')
    .get(id);
  assert.equal(movements.c, 1); // only the opening movement
});

test('7b. stock can never go negative (draining to exactly 0 is allowed)', async () => {
  const { body: created } = await post('/products', { name: 'Drain', quantity: 5, reorder_level: 1 });
  const id = created.product.id;

  const ok = await post(`/products/${id}/stock-out`, { quantity: 5 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.product.quantity, 0);
  assert.equal(ok.body.product.status, 'OUT_OF_STOCK');

  const over = await post(`/products/${id}/stock-out`, { quantity: 1 });
  assert.equal(over.status, 400);
  assert.match(over.body.error, /insufficient stock/i);
});

/* ----------------------------- 8. LOW_STOCK (Coffee 10 -> 3) ----------------------------- */

test('8. Coffee 10 -> 3 triggers exactly one LOW_STOCK alert', async () => {
  // Reset Coffee to the documented demo start state: 10, reorder 3.
  const c = await coffee();
  db.prepare('UPDATE products SET quantity = 10, reorder_level = 3 WHERE id = ?').run(c.id);
  db.prepare('DELETE FROM alerts WHERE product_id = ?').run(c.id);

  const res = await post(`/products/${c.id}/stock-out`, { quantity: 7 });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.quantity, 3);
  assert.equal(res.body.product.status, 'LOW_STOCK');

  const alerts = await get('/alerts');
  const coffeeAlerts = alerts.body.alerts.filter((a) => a.product_id === c.id);
  assert.equal(coffeeAlerts.length, 1);
  assert.equal(coffeeAlerts[0].type, 'LOW_STOCK');
  assert.equal(coffeeAlerts[0].status, 'UNRESOLVED');
  assert.match(coffeeAlerts[0].message, /Coffee/);
  assert.equal(coffeeAlerts[0].product_name, 'Coffee');
  assert.ok(coffeeAlerts[0].created_at);
});

test('8b. repeated mutations never duplicate an unresolved alert', async () => {
  const c = await coffee();
  await post(`/products/${c.id}/stock-in`, { quantity: 1 }); // 3 -> 4 still low
  await post(`/products/${c.id}/stock-out`, { quantity: 1 }); // 4 -> 3 low again

  const alerts = await get('/alerts');
  const unresolvedForCoffee = alerts.body.alerts.filter(
    (a) => a.product_id === c.id && a.status === 'UNRESOLVED',
  );
  assert.equal(unresolvedForCoffee.length, 1);
  assert.equal(unresolvedForCoffee[0].type, 'LOW_STOCK');
});

/* ----------------------------- 9. OUT_OF_STOCK (Coffee 3 -> 0) ----------------------------- */

test('9. Coffee 3 -> 0 resolves the LOW_STOCK alert and raises OUT_OF_STOCK', async () => {
  const c = await coffee();
  assert.equal(c.quantity, 3, 'precondition: Coffee should be at 3');

  const res = await post(`/products/${c.id}/stock-out`, { quantity: 3 });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.quantity, 0);
  assert.equal(res.body.product.status, 'OUT_OF_STOCK');

  const all = await get('/alerts?status=all');
  const coffeeAlerts = all.body.alerts.filter((a) => a.product_id === c.id);

  // No LOW_STOCK alert may remain unresolved; history rows stay as RESOLVED.
  const unresolvedLow = coffeeAlerts.filter((a) => a.type === 'LOW_STOCK' && a.status === 'UNRESOLVED');
  assert.equal(unresolvedLow.length, 0, 'LOW_STOCK alert must be resolved');
  assert.ok(
    coffeeAlerts.some((a) => a.type === 'LOW_STOCK' && a.status === 'RESOLVED'),
    'resolved LOW_STOCK history should be retained',
  );

  const unresolvedOut = coffeeAlerts.filter((a) => a.type === 'OUT_OF_STOCK' && a.status === 'UNRESOLVED');
  assert.equal(unresolvedOut.length, 1, 'exactly one unresolved OUT_OF_STOCK alert');
  assert.match(unresolvedOut[0].message, /out of stock/i);
});

test('9b. restocking resolves the OUT_OF_STOCK alert', async () => {
  const c = await coffee();
  const res = await post(`/products/${c.id}/stock-in`, { quantity: 10 });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.quantity, 10);
  assert.equal(res.body.product.status, 'NORMAL');

  const unresolved = await get('/alerts');
  const coffeeUnresolved = unresolved.body.alerts.filter((a) => a.product_id === c.id);
  assert.equal(coffeeUnresolved.length, 0, 'NORMAL product must have no unresolved alerts');
});

test('9c. raising reorder_level can re-trigger an alert', async () => {
  const { body: created } = await post('/products', { name: 'Threshold', quantity: 5, reorder_level: 1 });
  const id = created.product.id;
  assert.equal(created.product.status, 'NORMAL');

  const res = await put(`/products/${id}`, { reorder_level: 10 });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.status, 'LOW_STOCK');

  const alerts = await get('/alerts');
  const found = alerts.body.alerts.filter((a) => a.product_id === id && a.status === 'UNRESOLVED');
  assert.equal(found.length, 1);
  assert.equal(found[0].type, 'LOW_STOCK');
});

/* ----------------------------- 10. dashboard stats ----------------------------- */

test('10. GET /dashboard/stats matches live data (both naming conventions)', async () => {
  const products = (await get('/products')).body.products;
  const expectedLow = products.filter((p) => p.status === 'LOW_STOCK').length;
  const expectedOut = products.filter((p) => p.status === 'OUT_OF_STOCK').length;
  const expectedQty = products.reduce((sum, p) => sum + p.quantity, 0);
  const expectedAlerts = (await get('/alerts')).body.count;

  const res = await get('/dashboard/stats');
  assert.equal(res.status, 200);

  // docs/PRD.md Section 14 — primary contract
  assert.equal(res.body.total_products, products.length);
  assert.equal(res.body.total_quantity, expectedQty);
  assert.equal(res.body.low_stock_count, expectedLow);
  assert.equal(res.body.out_of_stock_count, expectedOut);
  assert.equal(res.body.critical_alerts, expectedAlerts);

  // PROJECT_SPEC Section 12 — aliases
  assert.equal(res.body.total_inventory, expectedQty);
  assert.equal(res.body.low_stock, expectedLow);
  assert.equal(res.body.out_of_stock, expectedOut);
});

/* ----------------------------- 11. GET /alerts ----------------------------- */

test('11. GET /alerts defaults to unresolved and supports ?status=all', async () => {
  const unresolved = await get('/alerts');
  assert.equal(unresolved.status, 200);
  assert.ok(unresolved.body.alerts.length > 0);
  for (const a of unresolved.body.alerts) {
    assert.equal(a.status, 'UNRESOLVED');
    assert.ok(['LOW_STOCK', 'OUT_OF_STOCK'].includes(a.type));
    assert.ok(a.product_id != null);
    assert.ok(a.message);
    assert.ok(a.created_at);
    assert.equal(a.product.id, a.product_id);
  }

  const resolved = await get('/alerts?status=resolved');
  assert.ok(resolved.body.alerts.length > 0, 'seeded data should have resolved alerts history');
  for (const a of resolved.body.alerts) assert.equal(a.status, 'RESOLVED');

  const all = await get('/alerts?status=all');
  assert.equal(
    all.body.count,
    unresolved.body.count + resolved.body.count,
    'all should be the union of unresolved + resolved',
  );

  assert.equal((await get('/alerts?status=bogus')).status, 400);
});

/* ----------------------------- misc ----------------------------- */

test('delete cascades to movements and alerts', async () => {
  const { body: created } = await post('/products', { name: 'Cascade', quantity: 1, reorder_level: 5 });
  const id = created.product.id;
  assert.equal((await get('/alerts')).body.alerts.some((a) => a.product_id === id), true);

  await del(`/products/${id}`);
  const movements = db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?').get(id);
  const alerts = db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE product_id = ?').get(id);
  assert.equal(movements.c, 0);
  assert.equal(alerts.c, 0);
});

test('malformed JSON returns a 400 with the error shape', async () => {
  const res = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(await res.json()), ['error']);
});

test('unknown route returns 404 and bad method returns 405', async () => {
  const nf = await get('/nope');
  assert.equal(nf.status, 404);
  assert.ok(nf.body.error);

  const wrongMethod = await del('/dashboard/stats');
  assert.equal(wrongMethod.status, 405);
  assert.ok(wrongMethod.body.error);
});

test('CORS preflight is answered', async () => {
  const res = await fetch(`${baseUrl}/products`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});
