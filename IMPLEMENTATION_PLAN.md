1. Target Database: Is this specifically for the LASSO/PRISMCollege database, or should it be generic for any SQL Server database?
2. MCP Framework: Are you planning to use TypeScript/Node.js (like most MCP examples), Python, or another language?
3. Query Capabilities: Do you want the tool to:
   - Only generate SQL queries (safer)
   - Execute SELECT queries only
   - Execute any SQL (including INSERT/UPDATE/DELETE)
4. Authentication: Will you use:
   - Windows Authentication (integrated security)
   - SQL Server authentication with credentials
   - Connection string from environment variables
5. Use Cases: Primary scenarios you want to support:
   - Schema exploration for documentation
   - Query generation for reports
   - Data migration/transformation
   - General SQL assistance

Here's a comprehensive plan assuming TypeScript/Node.js and read-only operations:

# SQL Server MCP Tools

An MCP (Model Context Protocol) server that provides AI agents with SQL Server schema introspection and intelligent query generation capabilities.

## Project Overview

This MCP server enables AI assistants to:
- Retrieve detailed schema information from SQL Server databases
- Understand table relationships and constraints
- Generate optimized SQL queries based on natural language requests
- Provide contextual information about database structure

## Architecture

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Assistant  │────▶│   MCP Server    │────▶│   SQL Server    │
│    (Claude)     │◀────│   (Node.js)     │◀────│    (LASSO)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                        │
        │                       │                        │
    JSON-RPC              SQL Queries              Database
    Protocol              via mssql                  Tables

## Features

### Core Capabilities
- **Schema Discovery**: Retrieve table structures, columns, data types, constraints
- **Relationship Mapping**: Understand foreign keys and table relationships
- **Query Generation**: Build SQL queries from natural language descriptions
- **Metadata Access**: Get table statistics, indexes, and documentation

### MCP Tools Exposed

#### 1. `get_schema`
Retrieves comprehensive schema information for specified tables.

**Parameters:**
- `tables`: string[] (optional) - List of table names
- `schema`: string (default: "dbo") - Database schema
- `includeRelationships`: boolean (default: true)
- `includeStatistics`: boolean (default: false)

**Returns:** JSON with table structures, columns, keys, relationships

#### 2. `get_table_info`
Quick lookup for single table structure.

**Parameters:**
- `table`: string - Table name
- `schema`: string (optional) - Database schema

**Returns:** Simplified JSON with column information

#### 3. `find_tables`
Search for tables by pattern or containing specific columns.

**Parameters:**
- `pattern`: string (optional) - Name pattern (supports wildcards)
- `hasColumn`: string (optional) - Tables containing this column
- `schema`: string (optional) - Database schema

**Returns:** List of matching table names with basic info

#### 4. `get_relationships`
Map relationships between tables for JOIN path discovery.

**Parameters:**
- `fromTable`: string - Source table
- `toTable`: string (optional) - Target table (or discover all)
- `maxDepth`: number (default: 2) - Relationship traversal depth

**Returns:** Graph of table relationships with JOIN conditions

## Project Structure

sql-server-mcp-tools/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── handlers/             # Tool implementation
│   │   ├── schema.ts         # Schema retrieval handlers
│   │   ├── search.ts         # Table/column search
│   │   ├── relationships.ts  # Relationship mapping
│   │   └── query.ts          # Query generation
│   ├── db/
│   │   ├── connection.ts     # SQL Server connection manager
│   │   ├── queries.ts        # SQL query templates
│   │   └── cache.ts          # Schema caching layer
│   └── utils/
│       ├── parser.ts         # SQL/JSON parsers
│       └── validator.ts      # Input validation
├── sql/
│   ├── GetSchemaMetadata.sql # Stored procedure
│   └── GetTableSchema.sql    # Function
├── config/
│   ├── default.json          # Default configuration
│   └── production.json       # Production settings
├── tests/
│   ├── schema.test.ts
│   └── fixtures/
├── docs/
│   ├── setup.md             # Installation guide
│   ├── usage.md             # Usage examples
│   └── api.md               # API documentation
├── package.json
├── tsconfig.json
├── .env.example
└── README.md

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1) ✅ COMPLETED
- [x] Initialize Node.js/TypeScript project
- [x] Set up MCP server boilerplate
- [x] Implement SQL Server connection with mssql package
- [x] Create connection pooling and error handling
- [x] Deploy stored procedures to database (SQL files ready)

### Phase 2: Schema Tools (Week 2) ✅ COMPLETED
- [x] Implement `get_schema` handler with JSON parsing
- [x] Implement `get_table_info` handler with JSON parsing
- [x] Add caching layer for schema metadata
- [x] Create JSON transformation utilities (built into SQL)
- [x] Optimized stored procedures with single JSON output

### Phase 3: Search & Relationships (Week 3) ✅ COMPLETED
- [x] Implement `find_tables` with pattern matching
- [x] Build relationship graph algorithm
- [x] Create JOIN path finder
- [x] Add relationship path discovery
- [x] Support multi-hop relationships

### Phase 4: Query Generation (Week 4) ✅ COMPLETED
- [x] Design query template system
- [x] Implement natural language parser
- [x] Build SQL query constructor
- [x] Add query optimization hints
- [x] Create query validation framework

### Phase 5: Testing & Documentation (Week 5) 🔄 IN PROGRESS
- [x] TypeScript compilation successful
- [ ] Integration testing with real database
- [ ] Performance optimization
- [ ] Write comprehensive documentation
- [ ] Create example notebooks
- [ ] Package for distribution

## Technical Stack

### Dependencies
- **@modelcontextprotocol/sdk**: MCP SDK for tool registration
- **mssql**: SQL Server client for Node.js
- **zod**: Schema validation
- **winston**: Logging
- **dotenv**: Environment configuration
- **typescript**: Type safety

### Dev Dependencies
- **@types/mssql**: TypeScript definitions
- **jest**: Testing framework
- **nodemon**: Development server
- **eslint**: Code linting
- **prettier**: Code formatting

## Configuration

### Environment Variables (.env)
```env
# Database Configuration
DB_SERVER=localhost
DB_DATABASE=LASSO
DB_USER=username          # For SQL auth
DB_PASSWORD=password      # For SQL auth
DB_DOMAIN=DOMAIN          # For Windows auth
DB_TRUSTED_CONNECTION=true # For Windows auth

# MCP Configuration
MCP_SERVER_NAME=sql-server-tools
MCP_SERVER_VERSION=1.0.0

# Cache Settings
CACHE_TTL=3600            # Schema cache TTL in seconds
CACHE_ENABLED=true

# Logging
LOG_LEVEL=info
LOG_FILE=mcp-server.log

Connection Configuration

{
"database": {
    "options": {
    "encrypt": true,
    "trustServerCertificate": true,
    "enableArithAbort": true
    },
    "pool": {
    "min": 2,
    "max": 10,
    "idleTimeoutMillis": 30000
    }
}
}

Usage Examples

In Claude Desktop

{
"mcpServers": {
    "sql-server-tools": {
    "command": "node",
    "args": ["path/to/sql-server-mcp-tools/dist/index.js"],
    "env": {
        "DB_SERVER": "localhost",
        "DB_DATABASE": "LASSO"
    }
    }
}
}

Example Interactions

Get schema information:
User: "Show me the structure of the CollegeEvaluation table"
Assistant: I'll retrieve the schema information for the CollegeEvaluation table.
[Calls get_schema tool]

Find relationships:
User: "How do I join Player to CollegeEvaluation?"
Assistant: Let me find the relationship path between these tables.
[Calls get_relationships tool]

Security Considerations

Access Control

- Read-only database access by default
- No direct SQL execution without explicit configuration
- Parameterized queries to prevent SQL injection
- Schema/table whitelist option

Data Protection

- No sensitive data in logs
- Connection string encryption
- Optional data masking for PII
- Audit logging for all operations

Performance Optimizations

Caching Strategy

- Cache schema metadata with configurable TTL
- Lazy-load relationships on demand
- Connection pooling for concurrent requests
- Batch operations where possible

Query Optimization

- Use stored procedures for complex operations
- Indexed lookups for table search
- Limit result sets appropriately
- Stream large results

Monitoring & Logging

Metrics to Track

- Tool invocation frequency
- Query generation accuracy
- Cache hit rates
- Response times
- Error rates

Logging Levels

- ERROR: Connection failures, SQL errors
- WARN: Deprecated usage, performance issues
- INFO: Tool invocations, cache refreshes
- DEBUG: SQL queries, response payloads

Future Enhancements

Planned Features

- Query execution with safety guards
- Schema change detection and notifications
- Query performance analysis
- Natural language to SQL training data collection
- Multi-database support
- GraphQL API generation from schema

Potential Integrations

- GitHub Copilot integration
- VS Code extension
- Jupyter notebook support
- Power BI dataset generation
- dbt model generation

Development Workflow

Local Development

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build

Testing Strategy

1. Unit tests for each handler
2. Integration tests with test database
3. Mock MCP client for end-to-end tests
4. Performance benchmarks
5. Security vulnerability scanning

Contributing

Code Standards

- TypeScript strict mode
- ESLint configuration
- 100% type coverage
- Comprehensive JSDoc comments
- Unit test coverage > 80%

Pull Request Process

1. Create feature branch
2. Implement with tests
3. Update documentation
4. Pass CI checks
5. Code review
6. Merge to main

License

MIT

Support

For issues or questions:
- GitHub Issues: [repo-url]/issues
- Documentation: [repo-url]/wiki

This plan provides a complete roadmap for your MCP SQL Server tools project. Would you like me to elaborate on any specific section or adjust based on your specific needs?