# Authentication

This server uses standard MySQL username/password authentication through `mysql2`.

Required environment variables:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_NAME=app_db
DB_USER=mcp_reader
DB_PASSWORD=change_me
DB_SSL=false
```

For managed MySQL providers that require TLS, set `DB_SSL=true`. If your provider requires custom certificate configuration, extend `src/mysql/connection.ts` to load the provider CA certificate and pass it in the mysql2 `ssl` option.

Recommended least-privilege grants:

```sql
CREATE USER 'mcp_reader'@'%' IDENTIFIED BY 'change_me';
GRANT SELECT, SHOW VIEW ON app_db.* TO 'mcp_reader'@'%';
FLUSH PRIVILEGES;
```
