/**
 * Manual seed script:  npm run seed
 *
 * Never wipes data — it only inserts demo products when the table is empty,
 * or appends them with --force. Then it reconciles the alert set.
 */

import { openDatabase, seedDatabase, seedIfEmpty } from '../src/db.js';
import { reconcileAllAlerts } from '../src/stock.js';

const force = process.argv.includes('--force');
const db = openDatabase();

const inserted = force ? seedDatabase(db) : seedIfEmpty(db);

if (inserted > 0) {
  console.log(`[seed] inserted ${inserted} demo products`);
} else {
  console.log('[seed] nothing to insert (products already exist)');
}

const reconciled = reconcileAllAlerts(db);
console.log(`[seed] reconciled alerts for ${reconciled} products`);

db.close();
