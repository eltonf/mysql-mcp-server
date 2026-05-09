import assert from 'node:assert/strict';
import test from 'node:test';
import { likePattern, quoteIdentifier } from './identifiers.js';

test('quoteIdentifier escapes backticks', () => {
  assert.equal(quoteIdentifier('order`items'), '`order``items`');
});

test('likePattern converts simple wildcards', () => {
  assert.equal(likePattern('*customer?'), '%customer_');
  assert.equal(likePattern(undefined), null);
});
