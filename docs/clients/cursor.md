# Cursor

Create or update `~/.cursor/mcp.json`:

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

Restart Cursor after editing the config.

Try:

```text
Use mysql to show me the database tables.
```
