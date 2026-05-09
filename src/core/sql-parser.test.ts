import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuery } from './sql-parser.js';

test('parseQuery extracts MySQL table aliases and columns', () => {
  const parsed = parseQuery(
    'SELECT c.id, c.email, o.total FROM customers c JOIN orders o ON o.customer_id = c.id',
    'app_db',
  );

  assert.equal(parsed.hasSelectStar, false);
  assert.deepEqual(
    parsed.tables.map((table) => table.table),
    ['customers', 'orders'],
  );
  assert.deepEqual(
    parsed.columns.map((column) => `${column.table}.${column.column}`),
    ['customers.id', 'customers.email', 'orders.total'],
  );
});

test('parseQuery detects SELECT star', () => {
  const parsed = parseQuery('SELECT * FROM customers', 'app_db');
  assert.equal(parsed.hasSelectStar, true);
  assert.deepEqual(parsed.selectStarTables, ['*']);
});

test('parseQuery handles CTE source tables but skips CTE references', () => {
  const parsed = parseQuery(
    'WITH recent_orders AS (SELECT id, customer_id FROM orders) SELECT c.email FROM customers c JOIN recent_orders r ON r.customer_id = c.id',
    'app_db',
  );

  assert(parsed.tables.some((table) => table.table === 'orders'));
  assert(parsed.tables.some((table) => table.table === 'customers'));
  assert(!parsed.tables.some((table) => table.table === 'recent_orders'));
});
