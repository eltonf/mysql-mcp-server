import assert from 'node:assert/strict';
import test from 'node:test';
import { maskDatabaseUrl, parseDatabaseUrl } from './database-url.js';

test('parseDatabaseUrl parses MySQL connection strings', () => {
  const result = parseDatabaseUrl('mysql://mcp_reader:s3cret@db.example.com:3307/app_db?ssl=true');

  assert.deepEqual(result, {
    host: 'db.example.com',
    port: 3307,
    name: 'app_db',
    user: 'mcp_reader',
    password: 's3cret',
    ssl: true,
  });
});

test('parseDatabaseUrl requires a MySQL protocol and database name', () => {
  assert.throws(() => parseDatabaseUrl('postgres://user:pass@localhost/app_db'), /mysql/);
  assert.throws(() => parseDatabaseUrl('mysql://user:pass@localhost'), /database name/);
});

test('maskDatabaseUrl hides passwords', () => {
  assert.equal(
    maskDatabaseUrl('mysql://mcp_reader:s3cret@localhost:3306/app_db'),
    'mysql://mcp_reader:********@localhost:3306/app_db',
  );
});
