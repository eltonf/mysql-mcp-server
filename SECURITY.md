# Security Policy

Please report security issues privately through the repository owner's preferred security contact once the GitHub repository is created. Do not open public issues for vulnerabilities.

## Notes

- `execute_query` is blocked unless `QUERY_ACCESS_CONFIG` is set.
- Use least-privilege MySQL users.
- Prefer `SCHEMA_ONLY_MODE=true` when an MCP client only needs metadata.
- Never commit real credentials or production access-control policies.
