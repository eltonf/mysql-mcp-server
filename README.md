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

Choose the appropriate setup script based on your security requirements:

#### Option A: Schema-Only Access (Recommended for Schema Introspection)

Use `Setup-Schema-User.sql` when you **ONLY** want schema metadata without data access.

**SSMS / Azure Data Studio:**
1. Open `Setup-Schema-User.sql`
2. Edit variables:
   ```sql
   DECLARE @LoginName NVARCHAR(128) = N'mcp_schema_only';
   DECLARE @Password NVARCHAR(128) = N'YourPassword123!';
   DECLARE @DatabaseList NVARCHAR(MAX) = N'LASSO,PRISM,PRISMCollege';
   ```
3. Execute (F5)

**Command Line:**
```bash
sqlcmd -S your-server -E -i Setup-Schema-User.sql \
  -v LoginName="mcp_schema_only" \
     Password="YourPassword123!" \
     DatabaseList="LASSO,PRISM,PRISMCollege"
```

**Permissions granted:**
- ✅ `VIEW ANY DEFINITION` (server-level)
- ✅ `VIEW DEFINITION` (per database)
- ❌ **NO** `db_datareader` (cannot read table data)

#### Option B: Full Access (Schema + Data Queries)

Use `Setup-Full-User.sql` when you want both schema metadata **AND** data queries.

**SSMS / Azure Data Studio:**
1. Open `Setup-Full-User.sql`
2. Edit variables:
   ```sql
   DECLARE @LoginName NVARCHAR(128) = N'mcp_full_access';
   DECLARE @Password NVARCHAR(128) = N'YourPassword123!';
   DECLARE @DatabaseList NVARCHAR(MAX) = N'LASSO,PRISM,PRISMCollege';
   ```
3. Execute (F5)

**Command Line:**
```bash
sqlcmd -S your-server -E -i Setup-Full-User.sql \
  -v LoginName="mcp_full_access" \
     Password="YourPassword123!" \
     DatabaseList="LASSO,PRISM,PRISMCollege"
```

**Permissions granted:**
- ✅ `VIEW ANY DEFINITION` (server-level)
- ✅ `VIEW DEFINITION` (per database)
- ✅ `db_datareader` (allows SELECT queries on data)

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

**For Schema-Only Access:**
```env
DB_SERVER=your-server.domain.com
DB_USER=mcp_schema_only
DB_PASSWORD=YourPassword123!
SCHEMA_ONLY_MODE=true  # Extra safety layer
```

**For Full Access:**
```env
DB_SERVER=your-server.domain.com
DB_USER=mcp_full_access
DB_PASSWORD=YourPassword123!
SCHEMA_ONLY_MODE=false  # Allow data query tools when implemented
```

**Windows NTLM (Windows only):**
```env
DB_SERVER=your-server.domain.com
DB_TRUSTED_CONNECTION=true
DB_DOMAIN=YOUR_DOMAIN
```

### 5. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sql-server-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/sql-server-mcp/dist/index.js"],
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
"Find all functions with 'Enhancement' in the name"
"Get the definition of fnGetHighestEnhancementGradeValueByYear"
"Show me all stored procedures in the dbo schema"
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

### `find_routines`
Search for stored procedures and functions by name pattern.

**Parameters:**
- `database` (required) - Database name
- `pattern` (optional) - Wildcard pattern (e.g., `*Enhancement*`, `fn*`, `sp*`)
- `type` (optional) - Filter by type: P=Procedure, FN=Scalar Function, IF/TF=Table Functions
- `schema` (optional) - Filter by schema

**Example:**
```
"Find all functions with 'Enhancement' in the name in LASSO database"
```

### `get_routine_definition`
Get complete definition of a stored procedure or function including source code, parameters, and description.

**Parameters:**
- `database` (required) - Database name
- `routine` (required) - Routine name (stored procedure or function)
- `schema` (optional) - Schema name (auto-detected if omitted)

**Example:**
```
"Get the definition of fnGetHighestEnhancementGradeValueByYear in LASSO"
```

### `get_routines_schema`
Batch retrieval of multiple stored procedures/functions (preferred for multiple routines).

**Parameters:**
- `database` (required) - Database name
- `routines` (optional) - Array of routine names (omit for all routines)
- `schema` (optional) - Schema name (auto-detected if omitted)

**Example:**
```
"Get definitions for spGetPlayer, spUpdatePlayer, and spDeletePlayer in LASSO"
```

## Architecture

### Core Design Principles

1. **Database per request**: Connection string doesn't specify a database - each tool call specifies which database to query via `USE [database]` statements
2. **Inline SQL with JSON**: All queries use SQL Server's `FOR JSON PATH` to return structured data in a single query, eliminating need for stored procedures
3. **Schema auto-detection**: If schema isn't specified, automatically detects the schema a table belongs to; handles ambiguous cases by prompting user to specify
4. **Fuzzy validation**: When objects aren't found, provides intelligent suggestions (case-insensitive, Levenshtein distance, plural/singular matching)
5. **Singleton connection pool**: Single database connection pool reused across all requests, with automatic database switching per query

### Key Features

- **Multi-database design**: Query LASSO, then PRISM, then any other database - all from a single connection
- **Inline JSON queries**: Uses SQL Server's `FOR JSON PATH` to return structured data in single queries
- **Schema auto-detection**: Automatically finds which schema a table/routine belongs to; prompts if ambiguous
- **Singleton connection pool**: Reuses one connection pool, switching database context per query with `USE [database]`
- **No database setup required**: No stored procedures or custom objects needed - works on any SQL Server
- **Zero performance cost**: Database switching with `USE [database]` is effectively free in SQL Server
- **System catalog views**: Universal queries work across all SQL Server databases

### Database Switching Pattern

All handlers use this pattern:
```typescript
// Build query with USE [database] prefix
const query = `USE [${database}]; SELECT ...`;
const result = await db.query(query);
```

The connection pool remains connected to `master` (default), but each query switches context. This enables:
- Query multiple databases from single connection
- No connection overhead per database
- Same performance as stored procedures
- Works on any SQL Server without setup

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

### SQL Server Authentication (Recommended)
Works on all platforms. Set `DB_USER` and `DB_PASSWORD` in `.env`.

**Example:**
```env
DB_SERVER=your-server.domain.com
DB_USER=mcp_schema_only
DB_PASSWORD=YourPassword123!
```

### Windows NTLM (Windows Only)
Only available on Windows machines. Set `DB_TRUSTED_CONNECTION=true` and `DB_DOMAIN`.

**Example:**
```env
DB_SERVER=your-server.domain.com
DB_TRUSTED_CONNECTION=true
DB_DOMAIN=YOUR_DOMAIN
```

**Note:** The mssql npm package (using tedious driver) does not support Kerberos authentication on macOS/Linux. Use SQL Server authentication instead.

## Troubleshooting

**"Login failed for user"**
- Verify credentials in `.env`
- Check that user has access to the database
- Verify SQL Server allows SQL authentication (not Windows-only mode)

**"Table not found"**
- Use `validate_objects` tool to check spelling and get suggestions
- Table may be in a different schema - try specifying `schema` parameter

**"Cannot open database"**
- Verify database name is correct
- Ensure user has been granted access to the database
- Run Setup-Schema-User.sql or Setup-Full-User.sql to grant permissions

**Connection timeouts**
- Check SQL Server is accessible: `ping your-server`
- Verify firewall allows port 1433

See [TESTING.md](TESTING.md) for detailed testing and troubleshooting information.

## Permission Model

This MCP server implements a dual-layer security model:

### Database-Level Permissions (Primary Security)

Two setup scripts provide different permission levels:

| Script | User Type | VIEW DEFINITION | db_datareader | Use Case |
|--------|-----------|-----------------|---------------|----------|
| `Setup-Schema-User.sql` | Schema-Only | ✅ | ❌ | Schema introspection without data access |
| `Setup-Full-User.sql` | Full Access | ✅ | ✅ | Schema + data queries (when implemented) |

**Recommendation:** Start with `Setup-Schema-User.sql` for maximum security. Upgrade to `Setup-Full-User.sql` only when you need data query capabilities.

### Application-Level Flag (Secondary Safety)

The `SCHEMA_ONLY_MODE` environment variable provides an additional safety layer:

- **`SCHEMA_ONLY_MODE=true`**: Data query tools are disabled in the MCP server (even if database permissions allow it)
- **`SCHEMA_ONLY_MODE=false`**: Data query tools are available (if implemented and if database permissions allow)

**Best Practice:** Combine both layers:
- Schema-only: Use `mcp_schema_only` user + `SCHEMA_ONLY_MODE=true`
- Full access: Use `mcp_full_access` user + `SCHEMA_ONLY_MODE=false`

## Environment Variables

**Required:**
- `DB_SERVER` - SQL Server hostname
- Authentication: `DB_USER`+`DB_PASSWORD`, `DB_TRUSTED_CONNECTION=true`, or `DB_USE_KERBEROS=true`

**Optional:**
- `DB_DOMAIN` - Domain for NTLM/Kerberos
- `SCHEMA_ONLY_MODE` - Disable data query tools (default: false)
- `CACHE_TTL` - Cache time-to-live in seconds (default: 3600)
- `CACHE_ENABLED` - Enable caching (default: true)
- `LOG_LEVEL` - Logging level: error, warn, info, debug (default: info)
- `MCP_SERVER_NAME` - Server name (default: sql-server-mcp)
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
- [AUTHENTICATION.md](AUTHENTICATION.md) - Authentication details
- [CLAUDE.md](CLAUDE.md) - Architecture and development guidance
