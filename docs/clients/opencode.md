# OpenCode

Add a local MCP server to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mysql": {
      "type": "local",
      "command": ["npx", "-y", "/mysql-mcp-server"],
      "enabled": true,
      "environment": {
        "DATABASE_URL": "mysql://mcp_reader:password@localhost:3306/app_db",
        "SCHEMA_ONLY_MODE": "true"
      }
    }
  }
}
```

For read-query support, add:

```json
{
  "SCHEMA_ONLY_MODE": "false",
  "QUERY_ACCESS_CONFIG": "/absolute/path/to/query-access.json"
}
```

Try:

```text
Use the mysql tool to show relationships from orders.
```
