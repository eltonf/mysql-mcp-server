#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import { db } from './db/connection.js';
import { logger } from './utils/logger.js';
import { getSchema, getTableInfo } from './handlers/schema.js';
import { findTables, searchObjects } from './handlers/search.js';
import { getRelationships } from './handlers/relationships.js';
import { validateDatabaseObject } from './handlers/validation.js';
import { findRoutines, getRoutineDefinition, getRoutinesSchema } from './handlers/routines.js';
import { getViewDefinition } from './handlers/views.js';
import { executeQuery } from './handlers/data.js';
import {
  loadAccessControlConfig,
  initAccessControl,
} from './security/access-control.js';

config();

const SERVER_NAME = process.env.MCP_SERVER_NAME || 'sql-server-mcp';
const SERVER_VERSION = process.env.MCP_SERVER_VERSION || '1.0.0';

// Schema-only mode: when true, only schema/metadata tools are available
// This is enforced even if the database user has data read permissions
const SCHEMA_ONLY_MODE = process.env.SCHEMA_ONLY_MODE === 'true';

// Define available tools
const tools: Tool[] = [
  {
    name: 'get_schema',
    description: 'Retrieves comprehensive schema information for one or more tables in a single efficient query. PREFERRED for batch operations - much faster than multiple get_table_info calls. Returns full table metadata including columns, data types, primary keys, foreign keys, indexes, and constraints. Example: tables=["Player", "PlayerAgent", "PlayerTeam"] gets all three tables in one query.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of table names to retrieve. For best performance with multiple tables, pass them all here instead of making separate calls. Leave empty to get all tables in schema.',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (optional). If not specified, will auto-detect schema. If table exists in multiple schemas, you will be asked to disambiguate.',
        },
        includeRelationships: {
          type: 'boolean',
          description: 'Include foreign key relationships (default: true)',
          default: true,
        },
        includeStatistics: {
          type: 'boolean',
          description: 'Include table statistics like row counts and sizes (default: false)',
          default: false,
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'get_table_info',
    description: 'Quick lookup for a single table. For multiple tables, use get_schema with tables array instead - it\'s much faster (one query vs N queries). IMPORTANT: If you get an error about table not found, use validate_objects first to find the correct table name.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        table: {
          type: 'string',
          description: 'Table name',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (optional). If not specified, will search all schemas and auto-detect. If ambiguous, error will list all matches.',
        },
      },
      required: ['database', 'table'],
    },
  },
  {
    name: 'find_tables',
    description: 'Search for tables by name pattern or containing specific columns. Returns list of table names with schema, row counts, and create dates. Supports wildcards (* and ?). Examples: pattern="*player*" finds tables with "player" in name, hasColumn="*redshirt*" finds tables with columns containing "redshirt".',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        pattern: {
          type: 'string',
          description: 'Table name pattern using wildcards: * (any characters) or ? (single character). Examples: "*player*", "tbl*", "dict*". Case-insensitive.',
        },
        hasColumn: {
          type: 'string',
          description: 'Find tables containing columns matching this pattern. Supports wildcards: * (any characters) or ? (single character). Examples: "*redshirt*", "PlayerID", "*_Date". Case-insensitive.',
        },
        schema: {
          type: 'string',
          description: 'Filter by schema name (default: search all schemas)',
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'search_objects',
    description: 'Search for tables and columns containing a search string. Returns tables with matching names AND tables that have columns with matching names. Supports wildcards (* and ?). Example: search="nfs" returns [{"schemaName":"dbo","tableName":"abcnfs"},{"schemaName":"dbo","tableName":"some_table","columnName":"mynfscolumn"}]',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        search: {
          type: 'string',
          description: 'Search string to find in table names or column names. Supports wildcards: * (any characters) or ? (single character). Case-insensitive.',
        },
        schema: {
          type: 'string',
          description: 'Filter by schema name (default: search all schemas)',
        },
        type: {
          type: 'string',
          enum: ['table', 'column', 'routine'],
          description: 'Filter results to a single object type. Options: table (table names), column (column names), routine (stored procedures/functions). Default: all types.',
        },
      },
      required: ['database', 'search'],
    },
  },
  {
    name: 'get_relationships',
    description: 'Map relationships between tables for JOIN path discovery.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        fromTable: {
          type: 'string',
          description: 'Source table name',
        },
        toTable: {
          type: 'string',
          description: 'Target table name (optional - if not provided, returns all relationships from source table)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum relationship traversal depth (default: 2)',
          default: 2,
        },
        schema: {
          type: 'string',
          description: 'Database schema name (optional). If not specified, will auto-detect schema.',
        },
      },
      required: ['database', 'fromTable'],
    },
  },
  {
    name: 'validate_objects',
    description: 'Validates that database, schema, and table names exist. Provides helpful suggestions and fuzzy matching if names are misspelled, case is incorrect, or plural/singular. ALWAYS use this FIRST when you get "not found" errors from other tools. Example: if "Players" fails, this will suggest "Player".',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name to validate (e.g., "LASSO", "PRISM")',
        },
        table: {
          type: 'string',
          description: 'Table name to validate (optional). Use either table or tables, not both.',
        },
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of table names to validate (optional). Use either table or tables, not both.',
        },
        schema: {
          type: 'string',
          description: 'Schema name to validate (optional). If not specified, will search all schemas.',
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'find_routines',
    description: 'Search for stored procedures and functions by name pattern. Returns list of routines with schema, type (PROCEDURE/SCALAR_FUNCTION/TABLE_FUNCTION), create/modify dates, and descriptions. Examples: pattern="*Enhancement*" finds all routines with "Enhancement" in name, type="FN" for scalar functions only.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        pattern: {
          type: 'string',
          description: 'Routine name pattern using wildcards: * (any characters) or ? (single character). Examples: "*player*", "fn*", "sp*". Case-insensitive.',
        },
        type: {
          type: 'string',
          enum: ['P', 'FN', 'IF', 'TF', 'PC', 'X'],
          description: 'Filter by routine type: P=Stored Procedure, FN=Scalar Function, IF=Inline Table Function, TF=Table Function, PC=CLR Procedure, X=Extended Procedure',
        },
        schema: {
          type: 'string',
          description: 'Filter by schema name (default: search all schemas)',
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'get_routine_definition',
    description: 'Get complete definition of a stored procedure or function including source code, parameters, and description. IMPORTANT: If you get an error about routine not found, use find_routines first to search for the correct name. Example: Get definition of fnGetHighestEnhancementGradeValueByYear.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        routine: {
          type: 'string',
          description: 'Routine name (stored procedure or function)',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (optional). If not specified, will search all schemas and auto-detect. If ambiguous, error will list all matches.',
        },
      },
      required: ['database', 'routine'],
    },
  },
  {
    name: 'get_routines_schema',
    description: 'Batch retrieval of multiple stored procedures and functions in a single efficient query. PREFERRED for multiple routines - much faster than multiple get_routine_definition calls. Returns full metadata including definitions, parameters, and descriptions. Example: routines=["spGetPlayer", "spUpdatePlayer", "spDeletePlayer"] gets all three in one query.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        routines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of routine names to retrieve. For best performance with multiple routines, pass them all here instead of making separate calls. Leave empty to get all routines in schema.',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (optional). If not specified, will auto-detect schema. If routines exist in multiple schemas, you will be asked to disambiguate.',
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'get_view_definition',
    description: 'Get complete definition of a view including SQL source code (CREATE VIEW statement), columns, and metadata. IMPORTANT: If you get an error about view not found, use validate_objects first to find the correct name. Example: Get definition of vw_dal_Player_Agent_info.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        view: {
          type: 'string',
          description: 'View name',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (optional). If not specified, will search all schemas and auto-detect. If ambiguous, error will list all matches.',
        },
      },
      required: ['database', 'view'],
    },
  },

  // Data query tools - only available when SCHEMA_ONLY_MODE is false
  ...(!SCHEMA_ONLY_MODE ? [
    {
      name: 'execute_query',
      description: 'Execute a SELECT query with safety controls. Queries are automatically limited to 100 rows maximum (configurable via MAX_QUERY_ROWS environment variable). Complex queries with JOINs, CTEs, subqueries, and aggregations are supported. Response includes `wasModified` flag and `modifications` array to show any changes made to your query for safety. Use ORDER BY to control which rows are sampled when limit is applied. IMPORTANT: Only SELECT queries allowed - no INSERT/UPDATE/DELETE/EXEC operations.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          database: {
            type: 'string',
            description: 'Database name (e.g., "LASSO", "PRISM")',
          },
          query: {
            type: 'string',
            description: 'SELECT query to execute. Supports JOINs, CTEs (WITH), subqueries, WHERE, GROUP BY, HAVING, ORDER BY. Will be automatically limited to 100 rows if no TOP clause exists, or TOP will be reduced to 100 if higher (configurable via MAX_QUERY_ROWS). Use ORDER BY to get meaningful sample data.',
          },
          parameters: {
            type: 'object',
            description: 'Optional parameters for parameterized queries (e.g., {"@id": 123, "@name": "value"})',
          },
        },
        required: ['database', 'query'],
      },
    },
  ] : []),
];

// Create server instance
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    logger.info(`Tool called: ${name}`, args);

    switch (name) {
      case 'get_schema': {
        const result = await getSchema(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_table_info': {
        const result = await getTableInfo(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'find_tables': {
        const result = await findTables(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'search_objects': {
        const result = await searchObjects(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_relationships': {
        const result = await getRelationships(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'validate_objects': {
        const { database, table, tables, schema } = args as any;

        // Handle both single table and array of tables
        if (tables && Array.isArray(tables)) {
          // Validate multiple tables
          const results = await Promise.all(
            tables.map((t: string) => validateDatabaseObject(database, t, schema))
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        } else {
          // Validate single table or just database/schema
          const result = await validateDatabaseObject(database, table, schema);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }
      }

      case 'find_routines': {
        const result = await findRoutines(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_routine_definition': {
        const result = await getRoutineDefinition(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_routines_schema': {
        const result = await getRoutinesSchema(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_view_definition': {
        const result = await getViewDefinition(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'execute_query': {
        if (SCHEMA_ONLY_MODE) {
          throw new Error('Data query operations are disabled. SCHEMA_ONLY_MODE is enabled. Set SCHEMA_ONLY_MODE=false to enable data queries.');
        }
        const result = await executeQuery(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    logger.error(`Error executing tool ${name}:`, error);

    // If error has validation details, return them in a user-friendly format
    if (error.validation) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              suggestions: error.validation.table?.suggestions || error.validation.database?.suggestions || [],
              availableObjects: error.validation.table?.tables || error.validation.database?.databases || [],
              validationDetails: error.validation
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    // Return regular error
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message || String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  try {
    // Test database connection
    await db.connect();
    logger.info('Database connection established');

    // Log schema-only mode status
    if (SCHEMA_ONLY_MODE) {
      logger.info('SCHEMA_ONLY_MODE enabled - data query tools disabled');
    } else {
      logger.info('Full access mode - all tools available');

      // Initialize access control for data queries (REQUIRED for data query access)
      // Restrictive by default: queries are blocked until QUERY_ACCESS_CONFIG is set
      if (process.env.QUERY_ACCESS_CONFIG) {
        try {
          const accessConfig = loadAccessControlConfig();
          initAccessControl(accessConfig);
          logger.info('Access control enabled for data queries');
        } catch (error: any) {
          logger.error('Failed to load access control config:', error.message);
          logger.error('Data queries will be blocked until config is fixed');
          // Don't exit - server can still function for schema tools
          // Data queries will fail with descriptive access control errors
        }
      } else {
        logger.warn('QUERY_ACCESS_CONFIG not set - data queries will be BLOCKED');
        logger.warn('Set QUERY_ACCESS_CONFIG environment variable to enable execute_query');
      }
    }

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`${SERVER_NAME} v${SERVER_VERSION} started`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await db.close();
  process.exit(0);
});

main();