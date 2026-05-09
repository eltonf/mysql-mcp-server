import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceRowLimit, validateQuerySafety } from './query-safety.js';

test('validateQuerySafety allows SELECT and WITH queries', () => {
  assert.doesNotThrow(() => validateQuerySafety('SELECT id, email FROM customers'));
  assert.doesNotThrow(() =>
    validateQuerySafety('WITH recent_orders AS (SELECT id FROM orders) SELECT id FROM recent_orders'),
  );
});

test('validateQuerySafety blocks write and file operations', () => {
  assert.throws(() => validateQuerySafety('DELETE FROM customers'), /forbidden/);
  assert.throws(() => validateQuerySafety('SELECT * INTO OUTFILE "/tmp/x" FROM customers'), /forbidden/);
});

test('enforceRowLimit appends a LIMIT when missing', () => {
  const result = enforceRowLimit('SELECT id FROM customers ORDER BY id', 100);
  assert.equal(result.wasModified, true);
  assert.equal(result.modifiedQuery, 'SELECT id FROM customers ORDER BY id LIMIT 100');
  assert.equal(result.appliedLimitValue, 100);
});

test('enforceRowLimit reduces an excessive LIMIT', () => {
  const result = enforceRowLimit('SELECT id FROM customers LIMIT 500', 100);
  assert.equal(result.wasModified, true);
  assert.equal(result.modifiedQuery, 'SELECT id FROM customers LIMIT 100');
  assert.equal(result.originalLimitValue, 500);
});

test('enforceRowLimit keeps an acceptable LIMIT', () => {
  const result = enforceRowLimit('SELECT id FROM customers LIMIT 25', 100);
  assert.equal(result.wasModified, false);
  assert.equal(result.modifiedQuery, 'SELECT id FROM customers LIMIT 25');
  assert.equal(result.appliedLimitValue, 25);
});
