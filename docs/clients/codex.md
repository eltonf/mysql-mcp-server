# Codex

Add the server as a local stdio MCP:

```bash
codex mcp add mysql \
  --env DATABASE_URL=mysql://mcp_reader:password@localhost:3306/app_db \
  -- npx -y @sigma4life/mysql-mcp-server
```

Verify:

```bash
codex mcp list
```

For read-query support, also pass:

```bash
--env SCHEMA_ONLY_MODE=false \
--env QUERY_ACCESS_CONFIG=/absolute/path/to/query-access.json
```

Try:

```text
Use mysql to find tables with an email column.
```
