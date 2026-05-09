# MySQL MCP Server

An open-source Model Context Protocol (MCP) server for MySQL schema introspection and guarded read-only queries. It helps MCP clients discover tables, columns, indexes, relationships, and safe queryable data from one configured MySQL database.

## Features

- Schema tools for tables, views, columns, primary keys, foreign keys, indexes, and approximate table statistics
- Table and column search with simple `*` and `?` wildcards
- Relationship discovery for join-path exploration
- Optional read-only `execute_query` tool with SELECT-only validation, access control, and automatic `LIMIT`
- Internal `src/core` boundary for code that can later be shared with other database-specific MCP servers

## Requirements

- Node.js 18+
- MySQL 8.x or a compatible MySQL service
- A MySQL user with read access to the configured database

## Setup

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Configure `.env`:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_NAME=app_db
DB_USER=mcp_reader
DB_PASSWORD=change_me
DB_SSL=false
```

This server connects to one configured database per process. Tool inputs may include `database` for compatibility, but it must match `DB_NAME`.

## Least-Privilege MySQL User

Schema-only usage needs metadata visibility and table access. Read-query usage also needs `SELECT` on allowed tables.

```sql
CREATE USER 'mcp_reader'@'%' IDENTIFIED BY 'change_me';
GRANT SELECT, SHOW VIEW ON app_db.* TO 'mcp_reader'@'%';
FLUSH PRIVILEGES;
```

Use a stronger host restriction and password in production.

## MCP Client Example

```json
{
  "mcpServers": {
    "mysql-mcp-server": {
      "command": "node",
      "args": ["/absolute/path/to/mysql-mcp-server/dist/index.js"],
      "env": {
        "DB_HOST": "localhost",
        "DB_PORT": "3306",
        "DB_NAME": "app_db",
        "DB_USER": "mcp_reader",
        "DB_PASSWORD": "change_me",
        "SCHEMA_ONLY_MODE": "true"
      }
    }
  }
}
```

To enable `execute_query`, set `SCHEMA_ONLY_MODE=false` and provide `QUERY_ACCESS_CONFIG`.

## Access Control

`execute_query` is blocked unless `QUERY_ACCESS_CONFIG` points to a JSON policy file. Example:

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "app_db": {
      "tables": {
        "mode": "whitelist",
        "list": ["customers", "orders", "products", "order_items"],
        "columnAccess": {
          "customers": {
            "mode": "exclusion",
            "columns": ["password_hash", "api_token"]
          }
        }
      }
    }
  }
}
```

## Tools

- `get_schema`
- `get_table_info`
- `find_tables`
- `search_objects`
- `get_relationships`
- `validate_objects`
- `get_accessible_schema`
- `get_accessible_table_info`
- `execute_query` when schema-only mode is disabled

Example prompts:

- "Show me the schema for the customers and orders tables."
- "Find tables with a column matching `*email*`."
- "Show relationships from orders to customers."
- "Run `SELECT id, email FROM customers ORDER BY id LIMIT 20`."

## Development

```bash
npm run build
npm test
npm run lint
```

The first implementation is MySQL-specific. Shared logic lives under `src/core` so future database-specific repos can extract or reuse it without carrying MySQL catalog code.
