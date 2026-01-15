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
│   ├── validation.ts       # validate_objects with fuzzy matching
│   └── data.ts             # execute_query with access control
├── security/
│   ├── types.ts            # Access control TypeScript interfaces
│   ├── config-loader.ts    # JSON config file loader
│   └── access-control.ts   # Query access validation logic
└── utils/
    ├── logger.ts           # Winston-based logging
    └── sql-parser.ts       # SQL parsing for access control
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

When `schema` parameter is omitted, queries check `INFORMATION_SCHEMA.TABLES` (for tables) or `sys.objects` (for routines) to find which schema contains the object:
- If found in one schema: auto-select it
- If found in multiple schemas: throw error with list of `schema.object` options, prompting user to specify
- If not found: use validation handler to suggest similar names

### Routine (Stored Procedure/Function) Introspection

Routines are introspected using `sys.objects`, `sys.sql_modules`, and `sys.parameters`:

**sys.objects types supported:**
- `P` - Stored Procedure
- `FN` - Scalar Function
- `IF` - Inline Table-Valued Function
- `TF` - Table-Valued Function
- `PC` - CLR Stored Procedure
- `X` - Extended Stored Procedure
- `FS`/`FT` - CLR Functions

**Query pattern for routine definitions:**
```sql
SELECT
  o.name, o.type,
  sm.definition AS source_code,  -- from sys.sql_modules
  (SELECT p.name, TYPE_NAME(p.user_type_id), p.is_output
   FROM sys.parameters p
   WHERE p.object_id = o.object_id
   FOR JSON PATH) AS parameters
FROM sys.objects o
LEFT JOIN sys.sql_modules sm ON o.object_id = sm.object_id
WHERE o.type IN ('P', 'FN', 'IF', 'TF', ...)
FOR JSON PATH
```

Handlers: `findRoutines()`, `getRoutineDefinition()`, `getRoutinesSchema()` in [src/handlers/routines.ts](src/handlers/routines.ts)

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

### find_routines
Search for stored procedures and functions by name pattern.
- Parameters: `database`, `pattern?`, `type?` (P/FN/IF/TF), `schema?`
- Returns: List of routines with schema, type, create/modify dates, descriptions
- Supports wildcards: `*` (any chars), `?` (single char)

### get_routine_definition
Get complete definition of a stored procedure or function.
- Parameters: `database`, `routine`, `schema?`
- Returns: Source code (from sys.sql_modules), parameters (from sys.parameters), description
- Auto-detects schema if not specified
- Example: Get definition of `fnGetHighestEnhancementGradeValueByYear`

### get_routines_schema
Batch retrieval of multiple routines' definitions in one query. PREFERRED over multiple `get_routine_definition` calls.
- Parameters: `database`, `routines[]?`, `schema?`
- Returns: Array of routine definitions with source code, parameters, descriptions
- Leave `routines` empty to get all routines in schema

### get_view_definition
Get complete definition of a view including SQL source code (CREATE VIEW statement).
- Parameters: `database`, `view`, `schema?`
- Returns: View definition, columns, source code
- Auto-detects schema if not specified

### get_accessible_schema
Shows all tables and columns accessible for SELECT queries based on the query access control configuration.
- Parameters: `database`, `schema?` (optional filter)
- Returns: List of accessible tables with their queryable columns
- **REQUIRES**: `QUERY_ACCESS_CONFIG` environment variable to be set
- Use this BEFORE `execute_query` to understand what data you can query
- Respects whitelist/blacklist table rules and column inclusion/exclusion rules
- Response includes:
  - `database`: Database name
  - `requireExplicitColumns`: Whether SELECT * is blocked
  - `configuredSchemas`: List of schemas with access rules
  - `tables[]`: Accessible tables with:
    - `schema`, `name`, `type` (TABLE/VIEW)
    - `columnAccessMode`: 'inclusion' or 'exclusion' (if column rules exist)
    - `accessibleColumns[]`: Columns you can query
    - `blockedColumns[]`: Columns blocked (exclusion mode only)
    - `allowedColumnsList[]`: Columns in whitelist (inclusion mode only)

**Example response:**
```json
{
  "database": "LASSO",
  "requireExplicitColumns": true,
  "configuredSchemas": ["dbo", "*"],
  "tables": [
    {
      "schema": "dbo",
      "name": "Player",
      "type": "TABLE",
      "columnAccessMode": "exclusion",
      "accessibleColumns": [
        { "name": "PlayerID", "dataType": "int", "isPrimaryKey": true, ... },
        { "name": "Name", "dataType": "nvarchar(100)", ... }
      ],
      "blockedColumns": ["Grade", "Medical", "SSN"]
    }
  ]
}
```

### get_accessible_table_info
Shows detailed column information for a specific table, with access status for each column.
- Parameters: `database`, `table`, `schema?`
- Returns: Full table schema with per-column access annotations
- **REQUIRES**: `QUERY_ACCESS_CONFIG` environment variable to be set
- Use this to check if specific columns are queryable before writing SELECT queries
- Response includes:
  - `isAccessible`: Whether the table can be queried at all
  - `accessDeniedReason`: Why table is blocked (if not accessible)
  - `columnAccessMode`: 'inclusion' or 'exclusion' (if column rules exist)
  - `columns[]`: All columns with:
    - Full metadata (name, type, nullable, isPrimaryKey, etc.)
    - `isAccessible`: Whether this column can be queried
    - `accessDeniedReason`: Why column is blocked (if not accessible)
  - `accessibleColumnCount` / `totalColumnCount`: Summary counts
  - `indexes[]`, `foreignKeys[]`: Table structure info

**Example response (accessible table):**
```json
{
  "database": "LASSO",
  "schema": "dbo",
  "table": "Player",
  "type": "TABLE",
  "isAccessible": true,
  "columnAccessMode": "exclusion",
  "columns": [
    { "name": "PlayerID", "dataType": "int", "isAccessible": true },
    { "name": "SSN", "dataType": "varchar(11)", "isAccessible": false, "accessDeniedReason": "Column in exclusion list: SSN, Medical, Grade" }
  ],
  "accessibleColumnCount": 15,
  "totalColumnCount": 18
}
```

**Example response (blocked table):**
```json
{
  "database": "LASSO",
  "schema": "dbo",
  "table": "AuditLog",
  "isAccessible": false,
  "accessDeniedReason": "Table is in blacklist"
}
```

### execute_query (Data Query Tool - requires SCHEMA_ONLY_MODE=false + QUERY_ACCESS_CONFIG)
Execute SELECT queries with automatic safety controls, access control filtering, and transparent modification feedback.
- Parameters: `database`, `query`, `parameters?` (optional)
- Supports: Complex JOINs, CTEs (WITH), subqueries, aggregations, GROUP BY, HAVING, ORDER BY
- **REQUIRES access control config**: Set `QUERY_ACCESS_CONFIG` environment variable pointing to JSON config file
- **Automatic row limit**: All queries limited to 100 rows max (configurable via MAX_QUERY_ROWS environment variable in MCP client config)
- **Query validation**: Only SELECT allowed - blocks INSERT/UPDATE/DELETE/EXEC/DROP/ALTER
- **Access control**: Table whitelist/blacklist, column access (inclusion/exclusion modes), SELECT * blocking (see Query Access Control section)
- **Transparent modifications**: Response includes:
  - `originalQuery`: What you sent
  - `executedQuery`: What actually ran
  - `wasModified`: Boolean flag
  - `modifications`: Array of changes made (e.g., "Added TOP 100 limit for safety")
  - `rows`: Result data
  - `rowCount`: Number of rows returned
  - `executionTimeMs`: Query performance
  - `limitReached`: Boolean (true if hit row limit, meaning more data exists)
  - `columnNames`: Array of column names in results
- **Best practices**: Use ORDER BY to control which rows are sampled when limit applies

**Example response when query is modified:**
```json
{
  "originalQuery": "SELECT * FROM Player WHERE Active = 1 ORDER BY Name",
  "executedQuery": "SELECT TOP 100 * FROM Player WHERE Active = 1 ORDER BY Name",
  "wasModified": true,
  "modifications": ["Added TOP 100 limit for safety"],
  "rows": [...],
  "rowCount": 100,
  "limitReached": true,
  "executionTimeMs": 45,
  "columnNames": ["PlayerID", "Name", "Active", ...]
}
```

**Recommended LLM workflow:**
1. Use `get_accessible_schema` to see what tables/columns you can actually query (respects access control)
2. Use `get_accessible_table_info` for detailed column access info on specific tables
3. Use `get_relationships` to identify foreign keys for JOINs
4. Write SELECT query with JOINs, WHERE, ORDER BY as needed (only use accessible columns!)
5. Call `execute_query` with your query
6. Check `wasModified` flag - if true, review `modifications` array
7. Analyze sample data (max 100 rows by default) and refine query if needed
8. If `limitReached` is true, consider adding more specific WHERE clauses or different ORDER BY

**Alternative workflow (when access control not configured):**
1. Use `find_tables` to discover relevant tables
2. Use `get_schema` or `get_table_info` to understand table structures
3. Continue from step 3 above

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

Data query specific:
- `SCHEMA_ONLY_MODE` - If `true`, disables data query tools entirely (default: false)
- `QUERY_ACCESS_CONFIG` - Path to JSON config file for table/column access control (REQUIRED for execute_query)
- `MAX_QUERY_ROWS` - Maximum rows returned per query (default: 100)
- `QUERY_TIMEOUT_MS` - Query timeout in milliseconds (default: 30000)

## Key Files for Modification

### Adding a new MCP tool

1. Add tool definition to `tools` array in `src/index.ts`
2. Create handler function in appropriate `src/handlers/*.ts` file
3. Add case handler in `server.setRequestHandler(CallToolRequestSchema, ...)` switch statement
4. Import handler function at top of `index.ts`

### Modifying SQL queries

Edit `src/db/queries.ts` which contains query builder functions:

**Table queries:**
- `buildGetSchemaMetadataQuery()` - Multi-table batch schema query
- `buildGetTableSchemaQuery()` - Single table schema query
- `buildFindTablesQuery()` - Search tables by pattern

**Routine queries:**
- `buildFindRoutinesQuery()` - Search stored procedures/functions by pattern
- `buildGetRoutineDefinitionQuery()` - Single routine with source code and parameters
- `buildGetRoutinesSchemaQuery()` - Batch query for multiple routines

These use complex nested `FOR JSON PATH` - be careful with aliasing and nesting levels.

### Authentication changes

Modify `src/db/connection.ts` constructor to add new auth methods or change config.

## Permission Model and Access Control

### Dual-Layer Security

The server implements two security layers:

**1. Database-Level Permissions (Primary)**

Two setup scripts create users with different permissions:

- **Setup-Schema-User.sql**: Creates `mcp_schema_only` user
  - Grants: `VIEW ANY DEFINITION` (server), `VIEW DEFINITION` (per DB)
  - Does NOT grant: `db_datareader`
  - Can: Read schema metadata, view table structures, relationships
  - Cannot: Read actual data from tables

- **Setup-Full-User.sql**: Creates `mcp_full_access` user
  - Grants: `VIEW ANY DEFINITION` (server), `VIEW DEFINITION` + `db_datareader` (per DB)
  - Can: Everything schema-only can do PLUS read data from tables

**2. Application-Level Flag (Secondary)**

`SCHEMA_ONLY_MODE` environment variable in `src/index.ts`:

```typescript
const SCHEMA_ONLY_MODE = process.env.SCHEMA_ONLY_MODE === 'true';
```

When `true`, data query tools are not registered with the MCP server (even if DB permissions would allow it).

### Data Query Tools Implementation

Data query capability is now implemented via the `execute_query` tool (see MCP Tools section above).

Implementation details:
- Tool registration: Conditionally added to tools array in [src/index.ts](src/index.ts) when `SCHEMA_ONLY_MODE=false`
- Handler: [src/handlers/data.ts](src/handlers/data.ts) - `executeQuery()` function
- Query validation & modification: [src/db/queries.ts](src/db/queries.ts) - `validateQuerySafety()` and `enforceRowLimit()` functions
- Safety features:
  - Automatic TOP limit injection/modification
  - SELECT-only validation (blocks DML/DDL/EXEC)
  - Configurable row limit (MAX_QUERY_ROWS env var, default 100)
  - Query timeout (QUERY_TIMEOUT_MS env var, default 30000ms)
  - Transparent modification feedback to LLM

### Best Practices

- **Schema-only deployment**: Use `mcp_schema_only` user + `SCHEMA_ONLY_MODE=true`
- **Full access deployment**: Use `mcp_full_access` user + `SCHEMA_ONLY_MODE=false` + `QUERY_ACCESS_CONFIG`
- **Never** give data read permissions to schema-only users - enforce at DB level
- **Always** check `SCHEMA_ONLY_MODE` before registering new data query tools

## Query Access Control

### Overview

The `execute_query` tool includes granular access control to prevent sensitive data exposure. Access control is **restrictive by default** - queries are blocked until a configuration file is set up.

**Key features:**
- Table whitelist/blacklist per database and schema
- Column-level access control with two modes:
  - `inclusion` (whitelist): Only listed columns can be queried - **most secure, prevents new column exposure**
  - `exclusion` (blacklist): Listed columns are blocked - easier to maintain but less secure
- Mandatory explicit column selection (blocks `SELECT *` and `table.*`)
- Informative error messages for blocked queries

### Configuration File

Set the `QUERY_ACCESS_CONFIG` environment variable to point to your JSON config file:

```bash
QUERY_ACCESS_CONFIG=/path/to/query-access.json
```

### Config File Structure

Hierarchical structure: `database → schema → table → column`

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "LASSO": {
      "schemas": {
        "dbo": {
          "tables": {
            "mode": "whitelist",
            "list": ["Player", "Team", "Game", "Coach", "Credentials"],
            "columnAccess": {
              "Player": {
                "mode": "exclusion",
                "columns": ["Grade", "Medical", "SSN", "DateOfBirth"]
              },
              "Coach": {
                "mode": "exclusion",
                "columns": ["Salary", "SSN"]
              },
              "Credentials": {
                "mode": "inclusion",
                "columns": ["UserId", "Status", "LastLogin"]
              }
            }
          }
        },
        "archive": {
          "tables": {
            "mode": "blacklist",
            "list": ["AuditLog", "DeletedRecords"]
          }
        }
      }
    },
    "PRISM": {
      "schemas": {
        "*": {
          "tables": {
            "mode": "whitelist",
            "list": ["Player", "School", "Evaluation"]
          }
        }
      }
    }
  }
}
```

### Configuration Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requireExplicitColumns` | boolean | Yes | If true, blocks `SELECT *` and `table.*` |
| `databases` | object | Yes | Map of database name → database config |
| `databases.[db].schemas` | object | No | Map of schema name → schema config (use `"*"` for all schemas) |
| `databases.[db].tables` | object | No | Shorthand when not using per-schema config |
| `tables.mode` | string | Yes | `"whitelist"`, `"blacklist"`, or `"none"` |
| `tables.list` | string[] | Yes | Table names (case-insensitive matching) |
| `columnAccess` | object | No | Map of table name → column access policy |
| `columnAccess.[table].mode` | string | Yes | `"inclusion"` (whitelist) or `"exclusion"` (blacklist) |
| `columnAccess.[table].columns` | string[] | Yes | Column names for the policy |

### Table Mode Behaviors

| Mode | Behavior |
|------|----------|
| `whitelist` | Only tables in `list` can be queried. All others blocked. |
| `blacklist` | Tables in `list` are blocked. All others allowed. |
| `none` | No table-level restrictions (column access rules still apply) |

### Column Access Mode Behaviors

| Mode | Behavior | Use Case |
|------|----------|----------|
| `inclusion` | Only columns in `columns` array can be queried. All others blocked. | **Recommended for sensitive tables** - new columns are blocked by default |
| `exclusion` | Columns in `columns` array are blocked. All others allowed. | Easier maintenance but less secure - new columns are allowed by default |

**Security recommendation:** Use `inclusion` mode for tables containing sensitive data. This ensures that when new columns are added to the database, they are blocked until explicitly added to the allowed list.

### Schema Wildcards

Use `"*"` as schema name to apply rules to all schemas in a database:

```json
{
  "databases": {
    "PRISM": {
      "schemas": {
        "*": {
          "tables": { "mode": "whitelist", "list": ["Player", "School"] }
        }
      }
    }
  }
}
```

### Compact Format

For simpler configs (single database, all schemas), omit the `schemas` level:

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "LASSO": {
      "tables": {
        "mode": "whitelist",
        "list": ["Player", "Team", "Game"],
        "columnAccess": {
          "Player": {
            "mode": "exclusion",
            "columns": ["Grade", "Medical"]
          }
        }
      }
    }
  }
}
```

### Error Messages

Access violations return clear, actionable messages:

| Scenario | Example Error Message |
|----------|----------------------|
| No config | `Access control not configured. Data queries are blocked until QUERY_ACCESS_CONFIG is set.` |
| Unknown database | `Database 'UnknownDB' is not configured for query access. Add it to QUERY_ACCESS_CONFIG.` |
| SELECT * | `SELECT * is not allowed. All SELECT statements must explicitly list columns.` |
| SELECT table.* | `SELECT t.* is not allowed. Please specify columns explicitly.` |
| Table not in whitelist | `Table 'LASSO.dbo.Credentials' is not in the allowed tables list. Allowed tables for LASSO.dbo: Player, Team, Game` |
| Blocked table | `Table 'LASSO.dbo.AuditLog' cannot be queried. This table is in the exclusion list.` |
| Excluded column (exclusion mode) | `Column 'SSN' from 'LASSO.dbo.Player' cannot be selected. Excluded columns: SSN, Medical, Grade` |
| Column not allowed (inclusion mode) | `Column 'Secret' from 'LASSO.dbo.Credentials' cannot be selected. Allowed columns for Credentials: UserId, Status, LastLogin` |
| Old config format | `Database 'LASSO' uses deprecated 'columnExclusions' format. Please migrate to 'columnAccess' with { mode: 'exclusion' | 'inclusion', columns: [...] } per table.` |

### Implementation Files

- **Types**: [src/security/types.ts](src/security/types.ts) - TypeScript interfaces
- **Config loader**: [src/security/config-loader.ts](src/security/config-loader.ts) - JSON validation and loading
- **Validation**: [src/security/access-control.ts](src/security/access-control.ts) - Query access validation
- **SQL Parser**: [src/utils/sql-parser.ts](src/utils/sql-parser.ts) - Parses SQL to extract tables/columns

### Disabling Access Control (Permissive Mode)

To allow all queries on a specific database:

```json
{
  "requireExplicitColumns": false,
  "databases": {
    "LASSO": {
      "tables": {
        "mode": "none",
        "list": []
      }
    }
  }
}
```

## Common Pitfalls

1. **Don't remove the `tables` parameter handling** from `validate_objects` - LLM clients expect to pass arrays
2. **Don't generate SQL queries in tool handlers** - that's the LLM's job; this server provides metadata only
3. **Don't use `DB_DATABASE` in .env** - defeats the multi-database design
4. **Don't forget `USE [database]` prefix** in all queries - required for database switching
5. **Always use FQDN** for `DB_SERVER` when using Kerberos authentication
6. **Don't grant `db_datareader` to schema-only users** - defeats the purpose of permission separation

## macOS Kerberos Setup

For Kerberos authentication on macOS:
1. Configure `~/.krb5.conf` with domain settings
2. Run `kinit username@DOMAIN.COM` to get ticket
3. Set `DB_USE_KERBEROS=true` in `.env`
4. Use FQDN for `DB_SERVER`

See [MACOS_SETUP.md](MACOS_SETUP.md) for detailed instructions.

## Recent Changes

- **Accessible schema tools** (Jan 2026) - Added `get_accessible_schema` and `get_accessible_table_info` tools:
  - `get_accessible_schema`: Shows all tables/columns accessible for SELECT queries based on access control config
  - `get_accessible_table_info`: Shows detailed column access status for a specific table
  - Helps LLMs understand what they can query BEFORE attempting `execute_query`
  - Respects whitelist/blacklist table rules and column inclusion/exclusion modes
  - New file: `src/handlers/accessible-schema.ts`
- **Column access policy modes** (Jan 2026) - Enhanced column-level access control with inclusion/exclusion modes:
  - New unified `columnAccess` config structure with per-table `mode` field
  - `inclusion` mode (whitelist): Only listed columns can be queried - **recommended for sensitive tables**
  - `exclusion` mode (blacklist): Listed columns are blocked - maintains previous behavior
  - Old `columnExclusions` format now throws an error with migration instructions
  - Prevents security gaps when new columns are added to the database
- **Query access control** (Jan 2026) - Added granular table/column access control for `execute_query`:
  - Hierarchical config: database → schema → table → column
  - Table whitelist/blacklist per database and schema
  - Column-level access control to hide sensitive data (SSN, Salary, Medical, etc.)
  - Blocks `SELECT *` and `table.*` (configurable via `requireExplicitColumns`)
  - Restrictive by default - queries blocked until `QUERY_ACCESS_CONFIG` is set
  - Uses `node-sql-parser` for reliable SQL parsing
  - New files: `src/security/types.ts`, `src/security/config-loader.ts`, `src/security/access-control.ts`, `src/utils/sql-parser.ts`
- **Data query capability** (Oct 2025) - Added `execute_query` tool for running SELECT queries with automatic safety controls:
  - Automatic TOP 100 row limit (configurable via MAX_QUERY_ROWS env var in MCP client config)
  - Transparent modification feedback - response shows if/how query was changed
  - Supports complex JOINs, CTEs, subqueries, aggregations
  - Only SELECT allowed - blocks DML/DDL/EXEC operations
  - 30-second timeout (configurable via QUERY_TIMEOUT_MS)
  - Conditional on SCHEMA_ONLY_MODE=false + db_datareader permissions
- **View introspection** (Oct 2025) - Added `get_view_definition` tool to retrieve view source code and columns
- **Routine introspection** (Oct 2025) - Added support for stored procedures and functions via `find_routines`, `get_routine_definition`, and `get_routines_schema` tools; uses `sys.objects`, `sys.sql_modules`, and `sys.parameters` for full metadata including source code and parameters
- **Permission model** (Oct 2025) - Split setup scripts into Schema-Only and Full Access; added `SCHEMA_ONLY_MODE` environment variable for dual-layer security
- **Removed `generate_query` tool** (Oct 2025) - was generating useless template queries; LLM clients should generate SQL directly using schema metadata from other tools
- **Added `tables[]` array parameter** to `validate_objects` for batch validation
- **Implemented smart schema auto-detection** with disambiguation for ambiguous tables and routines
