/**
 * Database inspection + integrity check:  npm run db:check
 *
 * Opens the database the same way the server does (so pending migrations are
 * applied), then reports the live schema, the indexes, the row counts and the
 * result of SQLite's own integrity_check / foreign_key_check.
 *
 *   node scripts/db-check.js                 # backend/data/inventory.db
 *   node scripts/db-check.js /tmp/other.db   # any other file
 *   DB_PATH=/tmp/other.db npm run db:check
 *
 * Exits non-zero if the schema or the data is not what the backend expects.
 */

import { SCHEMA_VERSION, describeSchema, openDatabase, verifySchema } from '../src/db.js';

const dbPath = process.argv[2] || process.env.DB_PATH;
const db = openDatabase(dbPath);
const { ok, problems, schema } = verifySchema(db);

const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`);

console.log('\nSmart Inventory — database report');
console.log('='.repeat(62));
line('file', dbPath ?? '(default)');
line('schema version', `${schema.userVersion} (expected ${SCHEMA_VERSION})`);
line('foreign_keys', schema.foreignKeys ? 'ON' : 'OFF');
line('integrity_check', schema.integrityCheck.join(', '));
line('foreign_key_check', schema.foreignKeyViolations === 0
  ? 'no orphaned rows'
  : `${schema.foreignKeyViolations} violation(s)`);

console.log('\nTables');
console.log('-'.repeat(62));
for (const [name, table] of Object.entries(schema.tables)) {
  console.log(`  ${name}  (${table.rowCount} row${table.rowCount === 1 ? '' : 's'})`);
  console.log(`    ${table.columns.join(', ')}`);
}

console.log('\nIndexes');
console.log('-'.repeat(62));
for (const index of schema.indexes) console.log(`  ${index}`);

console.log('\nDDL');
console.log('-'.repeat(62));
for (const [name, table] of Object.entries(schema.tables)) {
  console.log(`\n  ${name}:`);
  console.log(table.sql);
}

console.log(`\n${'='.repeat(62)}`);
if (ok) {
  console.log('RESULT: OK — database matches the expected schema.\n');
} else {
  console.log('RESULT: PROBLEMS');
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log('');
}

db.close();
process.exit(ok ? 0 : 1);
