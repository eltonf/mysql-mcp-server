# SQL Server MCP Tools

Model Context Protocol (MCP) server providing SQL Server schema introspection and database metadata tools for LLM applications like Claude Desktop.

## Features

- 🔍 **Schema Discovery** - Get detailed table schemas, columns, keys, and indexes
- 🔎 **Table Search** - Find tables by name patterns or column names
- 🔗 **Relationship Mapping** - Discover foreign key relationships for JOIN operations
- ✅ **Smart Validation** - Fuzzy matching with suggestions for misspelled table names
- 🗄️ **Multi-Database Support** - Query multiple databases from a single connection
- 🚀 **No Stored Procedures** - Uses inline SQL with `FOR JSON PATH` for zero database setup
- 🔐 **Flexible Authentication** - SQL Server, Windows NTLM, or Kerberos (macOS/Linux)
- ⚡ **Performance** - Built-in caching and batch operations

## Quick Start

### 1. Prerequisites

- Node.js >= 18.0.0
- SQL Server instance with read access
- Database user with `VIEW DEFINITION` permissions

### 2. Setup Database User

Run the included setup script to create a read-only user:

**Option A: SSMS / Azure Data Studio**
1. Open `Setup-User.sql` in your SQL client
2. Edit variables at top:
   ```sql
   DECLARE @LoginName NVARCHAR(128) = N'mcp_readonly';
   DECLARE @Password NVARCHAR(128) = N'YourPassword123!';
   DECLARE @DatabaseList NVARCHAR(MAX) = N'LASSO,PRISM,PRISMCollege';
   ```
3. Select all (Ctrl+A) and execute (F5)

**Option B: Command Line (sqlcmd)**
```bash
sqlcmd -S your-server -E -i Setup-User.sql \
  -v LoginName="mcp_readonly" \
     Password="YourPassword123!" \
     DatabaseList="LASSO,PRISM,PRISMCollege"
```

The script will:
- Create the login on the SQL Server instance
- Grant `VIEW ANY DEFINITION` permission
- Create users in specified databases
- Grant `db_datareader` role and `VIEW DEFINITION` permissions
- Validate databases exist and show status messages

### 3. Install and Build

```bash
npm install
npm run build
```

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your SQL Server credentials:

**SQL Server Authentication (all platforms):**
```env
DB_SERVER=your-server.domain.com
DB_USER=mcp_readonly
DB_PASSWORD=YourPassword123!
```

**Windows NTLM (Windows only):**
```env
DB_SERVER=your-server.domain.com
DB_TRUSTED_CONNECTION=true
DB_DOMAIN=YOUR_DOMAIN
```

**Kerberos (macOS/Linux):**
```env
DB_SERVER=your-server.domain.com  # Use FQDN
DB_USE_KERBEROS=true
DB_DOMAIN=YOUR_DOMAIN
```

For Kerberos, also run: `kinit username@DOMAIN.COM`

### 5. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sql-server-tools": {
      "command": "node",
      "args": ["/absolute/path/to/sql-server-mcp-tools/dist/index.js"],
      "env": {
        "DB_SERVER": "your-server.domain.com",
        "DB_USER": "mcp_readonly",
        "DB_PASSWORD": "YourPassword123!",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 6. Restart Claude Desktop

Completely quit and restart Claude Desktop for changes to take effect.

## Usage

Ask Claude to query your databases:

```
"Get the schema for the Player table in LASSO database"
"Find all tables in PRISM that contain the word 'Team'"
"Show me the relationships between Player and Team tables"
"Validate that the Players table exists in LASSO"
```

## Available MCP Tools

### `get_schema`
Batch retrieval of multiple tables' metadata (preferred for multiple tables).

**Parameters:**
- `database` (required) - Database name
- `tables` (optional) - Array of table names (omit for all tables)
- `schema` (optional) - Schema name (auto-detected if omitted)
- `includeRelationships` (optional) - Include foreign keys (default: true)
- `includeStatistics` (optional) - Include row counts/sizes (default: false)

### `get_table_info`
Quick lookup for a single table.

**Parameters:**
- `database` (required) - Database name
- `table` (required) - Table name
- `schema` (optional) - Schema name (auto-detected if omitted)

### `find_tables`
Search tables by name pattern or column name.

**Parameters:**
- `database` (required) - Database name
- `pattern` (optional) - Wildcard pattern (e.g., `*player*`, `tbl*`)
- `hasColumn` (optional) - Find tables with specific column
- `schema` (optional) - Filter by schema

### `get_relationships`
Discover foreign key relationships between tables.

**Parameters:**
- `database` (required) - Database name
- `fromTable` (required) - Source table
- `toTable` (optional) - Target table
- `maxDepth` (optional) - Traversal depth (default: 2)
- `schema` (optional) - Schema name

### `validate_objects`
Validate database/schema/table names with fuzzy matching.

**Parameters:**
- `database` (required) - Database name
- `table` or `tables[]` (optional) - Table name(s) to validate
- `schema` (optional) - Schema name

## Architecture

- **Multi-database design**: Each tool call specifies which database to query via `USE [database]` statements
- **Inline JSON queries**: Uses SQL Server's `FOR JSON PATH` to return structured data in single queries
- **Schema auto-detection**: Automatically finds which schema a table belongs to
- **Singleton connection pool**: Reuses one connection pool, switching database context per query
- **No database setup required**: No stored procedures or custom objects needed

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Format code
npm run format

# Lint
npm run lint

# Start server
npm start
```

## Authentication Setup

### SQL Server Authentication
Works on all platforms. Set `DB_USER` and `DB_PASSWORD` in `.env`.

### Windows NTLM
Windows only. Set `DB_TRUSTED_CONNECTION=true` and `DB_DOMAIN`.

### Kerberos (macOS/Linux)
1. Configure `~/.krb5.conf` with your domain
2. Run `kinit username@DOMAIN.COM`
3. Set `DB_USE_KERBEROS=true` and `DB_DOMAIN`
4. Use FQDN for `DB_SERVER`

See [MACOS_SETUP.md](MACOS_SETUP.md) for detailed Kerberos setup instructions.

## Troubleshooting

**"Login failed for user"**
- Verify credentials in `.env`
- Check that user has access to the database
- For Kerberos: verify ticket with `klist`

**"Table not found"**
- Use `validate_objects` tool to check spelling and get suggestions
- Table may be in a different schema - try specifying `schema` parameter

**"Cannot open database"**
- Verify database name is correct
- Ensure user has been granted access to the database
- Run Setup-User.sql to grant permissions

**Connection timeouts**
- Check SQL Server is accessible: `ping your-server`
- Verify firewall allows port 1433
- For Kerberos: use FQDN for server name

See [TESTING.md](TESTING.md) for detailed testing and troubleshooting information.

## Environment Variables

**Required:**
- `DB_SERVER` - SQL Server hostname
- Authentication: `DB_USER`+`DB_PASSWORD`, `DB_TRUSTED_CONNECTION=true`, or `DB_USE_KERBEROS=true`

**Optional:**
- `DB_DOMAIN` - Domain for NTLM/Kerberos
- `CACHE_TTL` - Cache time-to-live in seconds (default: 3600)
- `CACHE_ENABLED` - Enable caching (default: true)
- `LOG_LEVEL` - Logging level: error, warn, info, debug (default: info)
- `MCP_SERVER_NAME` - Server name (default: sql-server-tools)
- `MCP_SERVER_VERSION` - Server version (default: 1.0.0)

## Contributing

This project uses TypeScript with ES modules. Key files:

- `src/index.ts` - MCP server entry point and tool definitions
- `src/handlers/*.ts` - Tool implementation handlers
- `src/db/connection.ts` - Database connection management
- `src/db/queries.ts` - SQL query builders

See [CLAUDE.md](CLAUDE.md) for architecture details.

## License

MIT

## Support

For issues and questions, see:
- [TESTING.md](TESTING.md) - Testing and troubleshooting guide
- [MACOS_SETUP.md](MACOS_SETUP.md) - macOS Kerberos setup
- [AUTHENTICATION.md](AUTHENTICATION.md) - Authentication details
