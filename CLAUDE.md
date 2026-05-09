# CLAUDE.md

This repository is `mysql-mcp-server`, a MySQL-specific MCP server for schema introspection and guarded read-only queries.

## Architecture

- `src/index.ts` registers MCP tools and starts the stdio server.
- `src/core/*` contains reusable code intended for future extraction:
  - config, logging, cache, MCP response helpers
  - schema metadata types
  - read-only query safety and `LIMIT` enforcement
  - SQL parsing and access-control validation
- `src/mysql/*` contains MySQL-specific code:
  - `mysql2` connection pool
  - identifier helpers
  - `information_schema` catalog queries
- `src/handlers/*` adapts MCP tool input/output to the MySQL implementation.

## Design Notes

- One MCP server instance connects to one configured MySQL database (`DB_NAME`).
- Tool `database` and `schema` inputs are compatibility fields and must match `DB_NAME` when provided.
- MySQL catalog metadata comes from `information_schema`.
- `execute_query` accepts read-only `SELECT`/`WITH` queries, validates access control, and enforces `LIMIT`.
- Routine/function definition tools are intentionally deferred for v1.

## Development Commands

```bash
npm run build
npm test
npm start
```

## Example Domain

Use neutral examples such as `app_db`, `customers`, `orders`, `products`, and `order_items`. Do not add company-specific databases, internal hostnames, personal usernames, or private schema names to public docs or tests.
