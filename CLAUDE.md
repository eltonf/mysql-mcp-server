# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SQL Server MCP (Model Context Protocol) server that provides schema introspection and database metadata tools for SQL Server databases. Designed to work with Claude Desktop and other MCP clients, enabling LLMs to query database schemas, discover tables, validate object names, and explore relationships without requiring stored procedures or special database permissions.

## Architecture

### Core Design Principles

1. **Database per request**: Connection string doesn't specify a database - each tool call specifies which database to query via `USE [database]` statements
2. **Inline SQL with JSON**: All queries use SQL Server's `FOR JSON PATH` to return structured data in a single query, eliminating need for stored procedures
3. **Schema auto-detection**: If schema isn't specified, automatically detects the schema a table belongs to; handles ambiguous cases by prompting user to specify
4. **Fuzzy validation**: When objects aren't found, provides intelligent suggestions (case-insensitive, Levenshtein distance, plural/singular matching)
5. **Singleton connection pool**: Single database connection pool reused across all requests, with automatic database switching per query

### Directory Structure

```
src/
├── index.ts                 # MCP server entry point, tool definitions
├── db/
│   ├── connection.ts        # Singleton DB pool, supports SQL/NTLM/Kerberos auth
│   ├── cache.ts            # In-memory TTL cache for schema metadata
│   └── queries.ts          # SQL query builders using FOR JSON PATH
├── handlers/
│   ├── schema.ts           # get_schema, get_table_info implementations
│   ├── search.ts           # find_tables with pattern matching
│   ├── relationships.ts    # get_relationships for JOIN discovery
│   └── validation.ts       # validate_objects with fuzzy matching
└── utils/
    └── logger.ts           # Winston-based logging
```

### Authentication Support

The connection module supports three authentication methods (configured in `.env`):

1. **SQL Server Authentication** (all platforms): `DB_USER` + `DB_PASSWORD`
2. **Windows NTLM** (Windows only): `DB_TRUSTED_CONNECTION=true` + `DB_DOMAIN`
3. **Kerberos** (macOS/Linux): `DB_USE_KERBEROS=true` + `DB_DOMAIN` (requires `kinit`)

### Database Switching Pattern

All handlers use this pattern:
```typescript
// Build query with USE [database] prefix
const query = `USE [${database}]; SELECT ...`;
const result = await db.query(query);
```

The connection pool remains connected to `master` (default), but each query switches context.

### Schema Auto-Detection

When `schema` parameter is omitted, queries check `INFORMATION_SCHEMA.TABLES` to find which schema contains the table:
- If found in one schema: auto-select it
- If found in multiple schemas: throw error with list of `schema.table` options, prompting user to specify
- If not found: use validation handler to suggest similar table names

### Query Construction with FOR JSON

All schema queries use nested `FOR JSON PATH` to construct structured responses:
```sql
SELECT (
  SELECT
    'TableName' AS 'table',
    (SELECT col1, col2 FROM ... FOR JSON PATH) AS 'columns',
    (SELECT ... FOR JSON PATH) AS 'foreignKeys'
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS JsonResult
```

This returns a single string that's parsed as JSON in TypeScript.

## Development Commands

```bash
# Build TypeScript to dist/
npm run build

# Watch mode for development
npm run dev

# Format code
npm run format

# Lint
npm run lint

# Start MCP server (after building)
npm start
# or
node dist/index.js
```

## Testing

There are no Jest tests in this project. Testing is done manually using:

1. **Test scripts** (referenced in TESTING.md but not committed):
   - Create ad-hoc `.mjs` or `.js` files to test handlers directly
   - Example: `node test_script.mjs` to test database connection

2. **Claude Desktop integration**:
   - Configure in `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Restart Claude Desktop and test via natural language queries

3. **MCP Inspector** (if available):
   - Use official MCP tools to inspect server behavior

## MCP Tools Available

### get_schema
Batch retrieval of multiple tables' metadata in one query. PREFERRED over multiple `get_table_info` calls.
- Parameters: `database`, `tables[]`, `schema?`, `includeRelationships?`, `includeStatistics?`
- Returns: Array of table metadata with columns, keys, indexes, constraints

### get_table_info
Single table lookup. Use `get_schema` for multiple tables.
- Parameters: `database`, `table`, `schema?`
- Auto-detects schema if not specified

### find_tables
Search tables by name pattern or column name.
- Parameters: `database`, `pattern?`, `hasColumn?`, `schema?`
- Supports wildcards: `*` (any chars), `?` (single char)

### get_relationships
Discover foreign key relationships for JOIN path discovery.
- Parameters: `database`, `fromTable`, `toTable?`, `maxDepth?`, `schema?`
- Returns relationship paths between tables

### validate_objects
Validates database/schema/table names with fuzzy matching and suggestions.
- Parameters: `database`, `table?` or `tables[]?`, `schema?`
- Provides spelling suggestions, case corrections, plural/singular matches

## Important Implementation Notes

### Schema vs DBO Default

**DO NOT** default schema to `'dbo'` in tool handlers. Let auto-detection work:
```typescript
// ❌ BAD - forces dbo even if table is in different schema
const schema = args.schema || 'dbo';

// ✅ GOOD - undefined triggers auto-detection
const schema = args.schema;
```

### Validation Before Schema Operations

When encountering "not found" errors, handlers should:
1. Catch the error
2. Call `validateDatabaseObject()` to get suggestions
3. Include suggestions in error response with `validation` property
4. LLM client can then call `validate_objects` tool explicitly

### Cache Usage

Schema cache is used in `handlers/schema.ts`:
- Key format: `${database}:${schema}:${table}`
- TTL from `CACHE_TTL` env var (default 3600s)
- Disable with `CACHE_ENABLED=false`

### Logging

Winston logger outputs to:
- Console (stdout) for info/debug
- `mcp-server.log` for all logs
- `error.log` for errors only

Set `LOG_LEVEL=debug` for verbose SQL query logging.

## Environment Variables

Required:
- `DB_SERVER` - SQL Server hostname (use FQDN for Kerberos)
- One of: `DB_USER`+`DB_PASSWORD`, `DB_TRUSTED_CONNECTION=true`, or `DB_USE_KERBEROS=true`

Optional:
- `DB_DOMAIN` - For NTLM or Kerberos
- `CACHE_TTL` - Cache time-to-live in seconds (default: 3600)
- `CACHE_ENABLED` - Enable/disable cache (default: true)
- `LOG_LEVEL` - Logging level: error, warn, info, debug (default: info)
- `MCP_SERVER_NAME` - Server name for MCP (default: sql-server-tools)
- `MCP_SERVER_VERSION` - Server version (default: 1.0.0)

## Key Files for Modification

### Adding a new MCP tool

1. Add tool definition to `tools` array in `src/index.ts`
2. Create handler function in appropriate `src/handlers/*.ts` file
3. Add case handler in `server.setRequestHandler(CallToolRequestSchema, ...)` switch statement
4. Import handler function at top of `index.ts`

### Modifying SQL queries

Edit `src/db/queries.ts` which contains query builder functions:
- `buildGetSchemaMetadataQuery()` - Multi-table batch schema query
- `buildGetTableSchemaQuery()` - Single table schema query

These use complex nested `FOR JSON PATH` - be careful with aliasing and nesting levels.

### Authentication changes

Modify `src/db/connection.ts` constructor to add new auth methods or change config.

## Common Pitfalls

1. **Don't remove the `tables` parameter handling** from `validate_objects` - LLM clients expect to pass arrays
2. **Don't generate SQL queries in tool handlers** - that's the LLM's job; this server provides metadata only
3. **Don't use `DB_DATABASE` in .env** - defeats the multi-database design
4. **Don't forget `USE [database]` prefix** in all queries - required for database switching
5. **Always use FQDN** for `DB_SERVER` when using Kerberos authentication

## macOS Kerberos Setup

For Kerberos authentication on macOS:
1. Configure `~/.krb5.conf` with domain settings
2. Run `kinit username@DOMAIN.COM` to get ticket
3. Set `DB_USE_KERBEROS=true` in `.env`
4. Use FQDN for `DB_SERVER`

See [MACOS_SETUP.md](MACOS_SETUP.md) for detailed instructions.

## Recent Changes

- Removed `generate_query` tool (Oct 2025) - was generating useless template queries; LLM clients should generate SQL directly using schema metadata from other tools
- Added `tables[]` array parameter to `validate_objects` for batch validation
- Implemented smart schema auto-detection with disambiguation for ambiguous tables
