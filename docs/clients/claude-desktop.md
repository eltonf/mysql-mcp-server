# Claude Desktop

Add this to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@sigma4life/mysql-mcp-server"],
      "env": {
        "DATABASE_URL": "mysql://mcp_reader:password@localhost:3306/app_db",
        "SCHEMA_ONLY_MODE": "true"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config.

For read-query support, set:

```json
{
  "SCHEMA_ONLY_MODE": "false",
  "QUERY_ACCESS_CONFIG": "/absolute/path/to/query-access.json"
}
```

Try:

```text
Show me the schema for customers and orders.
```
