import assert from 'node:assert/strict';

const API_BASE = 'http://localhost:4000';

async function runTest() {
  console.log('🚀 Running Full Primary Demo & End-to-End API Integration Suite...');

  // 1. Health check
  console.log('\n--- 1. Health check ---');
  const healthRes = await fetch(`${API_BASE}/health`);
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  console.log('Health:', healthData);

  // 2. Initial Dashboard Stats
  console.log('\n--- 2. Initial Dashboard Stats ---');
  const statsRes1 = await fetch(`${API_BASE}/dashboard/stats`);
  assert.equal(statsRes1.status, 200);
  const stats1 = await statsRes1.json();
  console.log('Initial stats:', stats1);

  // 3. Primary Demo Step 1: Add product Coffee (Qty 10, Reorder 3)
  console.log('\n--- 3. Primary Demo: Add Coffee (Qty: 10, Reorder: 3) ---');
  const createRes = await fetch(`${API_BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Coffee',
      category: 'Beverages',
      quantity: 10,
      reorder_level: 3,
      price: 4.5,
      supplier: 'Acme Supplies',
    }),
  });
  assert.equal(createRes.status, 200);
  const { product: coffee } = await createRes.json();
  console.log('Created product:', coffee);
  assert.equal(coffee.name, 'Coffee');
  assert.equal(coffee.quantity, 10);
  assert.equal(coffee.reorder_level, 3);
  assert.equal(coffee.status, 'NORMAL');

  // 4. Primary Demo Step 2: Stock Out until quantity reaches 3 -> status LOW_STOCK
  console.log('\n--- 4. Primary Demo: Stock Out 7 units (10 -> 3) ---');
  const stockOut1Res = await fetch(`${API_BASE}/products/${coffee.id}/stock-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 7 }),
  });
  assert.equal(stockOut1Res.status, 200);
  const { product: coffeeLow } = await stockOut1Res.json();
  console.log('Coffee after stock out 7:', coffeeLow);
  assert.equal(coffeeLow.quantity, 3);
  assert.equal(coffeeLow.status, 'LOW_STOCK');

  // Verify alert raised
  const alertsRes1 = await fetch(`${API_BASE}/alerts?status=unresolved`);
  assert.equal(alertsRes1.status, 200);
  const { alerts: alerts1 } = await alertsRes1.json();
  const coffeeLowAlert = alerts1.find((a) => a.product_id === coffee.id && a.type === 'LOW_STOCK');
  console.log('Active LOW_STOCK alert found:', coffeeLowAlert);
  assert.ok(coffeeLowAlert, 'LOW_STOCK alert must exist for Coffee');

  // 5. Test Insufficient Stock rejection
  console.log('\n--- 5. Test Insufficient Stock: Attempt Stock Out 10 from stock 3 ---');
  const stockOutInvalidRes = await fetch(`${API_BASE}/products/${coffee.id}/stock-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 10 }),
  });
  assert.equal(stockOutInvalidRes.status, 400);
  const errData = await stockOutInvalidRes.json();
  console.log('Rejected error response as expected:', errData);
  assert.match(errData.error, /Insufficient stock/i);

  // 6. Primary Demo Step 3: Stock Out 3 units -> quantity reaches 0 -> status OUT_OF_STOCK
  console.log('\n--- 6. Primary Demo: Stock Out 3 units (3 -> 0) ---');
  const stockOut2Res = await fetch(`${API_BASE}/products/${coffee.id}/stock-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 3 }),
  });
  assert.equal(stockOut2Res.status, 200);
  const { product: coffeeOut } = await stockOut2Res.json();
  console.log('Coffee after stock out 3:', coffeeOut);
  assert.equal(coffeeOut.quantity, 0);
  assert.equal(coffeeOut.status, 'OUT_OF_STOCK');

  // Verify OUT_OF_STOCK alert raised and LOW_STOCK resolved
  const alertsRes2 = await fetch(`${API_BASE}/alerts?status=unresolved`);
  const { alerts: alerts2 } = await alertsRes2.json();
  const coffeeOutAlert = alerts2.find((a) => a.product_id === coffee.id && a.type === 'OUT_OF_STOCK');
  const lingeringLowAlert = alerts2.find((a) => a.product_id === coffee.id && a.type === 'LOW_STOCK');
  console.log('Active OUT_OF_STOCK alert found:', coffeeOutAlert);
  assert.ok(coffeeOutAlert, 'OUT_OF_STOCK alert must exist');
  assert.equal(lingeringLowAlert, undefined, 'LOW_STOCK alert must be resolved');

  // 7. Verify Dashboard Stats updated
  console.log('\n--- 7. Verify Dashboard Stats ---');
  const statsRes3 = await fetch(`${API_BASE}/dashboard/stats`);
  const stats3 = await statsRes3.json();
  console.log('Stats after out of stock:', stats3);
  assert.ok((stats3.out_of_stock_count ?? stats3.out_of_stock) >= 1);

  // 8. Stock In 15 units -> returns to NORMAL
  console.log('\n--- 8. Restock In 15 units ---');
  const stockInRes = await fetch(`${API_BASE}/products/${coffee.id}/stock-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 15 }),
  });
  assert.equal(stockInRes.status, 200);
  const { product: coffeeRestocked } = await stockInRes.json();
  console.log('Restocked Coffee:', coffeeRestocked);
  assert.equal(coffeeRestocked.quantity, 15);
  assert.equal(coffeeRestocked.status, 'NORMAL');

  // 9. Edit Product
  console.log('\n--- 9. Edit Product ---');
  const editRes = await fetch(`${API_BASE}/products/${coffee.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Organic Premium Coffee',
      price: 6.99,
    }),
  });
  assert.equal(editRes.status, 200);
  const { product: coffeeEdited } = await editRes.json();
  console.log('Edited Coffee:', coffeeEdited);
  assert.equal(coffeeEdited.name, 'Organic Premium Coffee');
  assert.equal(coffeeEdited.price, 6.99);

  // 10. Delete Product
  console.log('\n--- 10. Delete Product ---');
  const delRes = await fetch(`${API_BASE}/products/${coffee.id}`, {
    method: 'DELETE',
  });
  assert.equal(delRes.status, 200);
  const delData = await delRes.json();
  console.log('Delete response:', delData);
  assert.equal(delData.deleted, true);

  console.log('\n🎉 ALL PRIMARY DEMO & END-TO-END INTEGRATION TESTS PASSED PERFECTLY!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
