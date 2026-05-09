# Contributing

Thanks for helping improve `mysql-mcp-server`.

## Development

```bash
npm install
npm run build
npm test
```

Keep MySQL-specific catalog behavior in `src/mysql/*`. Shared behavior that could apply to future database-specific MCP servers belongs in `src/core/*`.

## Pull Requests

- Keep examples generic and public-safe.
- Add tests for query-safety, parser, access-control, or MySQL catalog changes where practical.
- Do not commit real credentials, hostnames, customer data, private database names, or personal usernames.
