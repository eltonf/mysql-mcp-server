# Claude Code

Add the server as a local stdio MCP:

```bash
claude mcp add --transport stdio mysql \
  --env DATABASE_URL=mysql://mcp_reader:password@localhost:3306/app_db \
  -- npx -y /mysql-mcp-server
```

For read-query support, also pass:

```bash
--env SCHEMA_ONLY_MODE=false \
--env QUERY_ACCESS_CONFIG=/absolute/path/to/query-access.json
```

Check status inside Claude Code:

```text
/mcp
```

Try:

```text
Use mysql to show me the tables in this database.
```
