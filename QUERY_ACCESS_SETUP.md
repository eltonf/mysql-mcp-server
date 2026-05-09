# Query Access Setup

`execute_query` is disabled until `QUERY_ACCESS_CONFIG` points to a JSON access-control file. This is intentionally restrictive so schema introspection can be enabled separately from data reads.

## Example Policy

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
          },
          "orders": {
            "mode": "inclusion",
            "columns": ["id", "customer_id", "status", "total", "created_at"]
          }
        }
      }
    }
  }
}
```

## Modes

- `whitelist`: only listed tables can be queried.
- `blacklist`: listed tables are blocked.
- `none`: table-level access is unrestricted, while column rules may still apply.
- `columnAccess.mode = inclusion`: only listed columns can be selected.
- `columnAccess.mode = exclusion`: listed columns are blocked.

When `requireExplicitColumns` is `true`, `SELECT *` and `table.*` are rejected. Prefer queries such as:

```sql
SELECT id, email, created_at FROM customers ORDER BY id LIMIT 20;
```

## MCP Env Example

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
        "SCHEMA_ONLY_MODE": "false",
        "QUERY_ACCESS_CONFIG": "/absolute/path/to/query-access.json"
      }
    }
  }
}
```
