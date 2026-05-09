# VS Code

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "mysql": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mysql-mcp-server"],
      "env": {
        "DATABASE_URL": "mysql://mcp_reader:password@localhost:3306/app_db",
        "SCHEMA_ONLY_MODE": "true"
      }
    }
  }
}
```

Try:

```text
Use mysql to inspect the customers table.
```
