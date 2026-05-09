#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { appConfig } from './core/config.js';
import { errorResult, textResult } from './core/mcp.js';
import { logger } from './core/logger.js';
import {
  initAccessControl,
  loadAccessControlConfig,
} from './core/security/access-control.js';
import { executeQuery } from './handlers/data.js';
import {
  getAccessibleSchema,
  getAccessibleTableInfo,
} from './handlers/accessible-schema.js';
import { getRelationships } from './handlers/relationships.js';
import { getSchema, getTableInfo } from './handlers/schema.js';
import { findTables, searchObjects } from './handlers/search.js';
import { validateDatabaseObject } from './handlers/validation.js';
import { db } from './mysql/connection.js';

const databaseProperty = {
  type: 'string',
  description:
    'Optional compatibility field. If provided, it must match the configured DB_NAME.',
};

const schemaProperty = {
  type: 'string',
  description:
    'Optional compatibility field. MySQL uses DB_NAME as the schema for this server.',
};

const tools: Tool[] = [
  {
    name: 'get_schema',
    description:
      'Retrieves MySQL schema information for one or more tables. Returns columns, data types, primary keys, foreign keys, indexes, and optional table statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        tables: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Table names to retrieve. Leave empty to get all tables in the configured database.',
        },
        schema: schemaProperty,
        includeRelationships: {
          type: 'boolean',
          description: 'Include foreign key relationships (default: true)',
          default: true,
        },
        includeStatistics: {
          type: 'boolean',
          description: 'Include approximate table row/size statistics (default: false)',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'get_table_info',
    description:
      'Gets detailed metadata for a single MySQL table or view. Use get_schema for batch table metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        table: {
          type: 'string',
          description: 'Table or view name, for example "customers"',
        },
        schema: schemaProperty,
      },
      required: ['table'],
    },
  },
  {
    name: 'find_tables',
    description:
      'Searches MySQL tables/views by name pattern or by containing a matching column. Supports * and ? wildcards.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        pattern: {
          type: 'string',
          description: 'Table name pattern, for example "*customer*" or "order_*".',
        },
        hasColumn: {
          type: 'string',
          description: 'Column name pattern, for example "*email*" or "created_at".',
        },
        schema: schemaProperty,
      },
      required: [],
    },
  },
  {
    name: 'search_objects',
    description:
      'Searches MySQL table and column names. Returns matching table and column references.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        search: {
          type: 'string',
          description: 'Search string or wildcard pattern, for example "order" or "*email*".',
        },
        schema: schemaProperty,
        type: {
          type: 'string',
          enum: ['table', 'column'],
          description: 'Optional object type filter.',
        },
      },
      required: ['search'],
    },
  },
  {
    name: 'get_relationships',
    description:
      'Maps foreign key relationships for JOIN path discovery between MySQL tables.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        fromTable: {
          type: 'string',
          description: 'Source table name',
        },
        toTable: {
          type: 'string',
          description:
            'Target table name. If omitted, returns direct relationships for fromTable.',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum relationship traversal depth (default: 2)',
          default: 2,
        },
        schema: schemaProperty,
      },
      required: ['fromTable'],
    },
  },
  {
    name: 'validate_objects',
    description:
      'Validates the configured database and optional MySQL table names, with suggestions for close table-name matches.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        table: {
          type: 'string',
          description: 'Single table name to validate.',
        },
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple table names to validate.',
        },
        schema: schemaProperty,
      },
      required: [],
    },
  },
  {
    name: 'get_accessible_schema',
    description:
      'Shows tables and columns accessible for SELECT queries based on QUERY_ACCESS_CONFIG.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        schema: schemaProperty,
      },
      required: [],
    },
  },
  {
    name: 'get_accessible_table_info',
    description:
      'Shows table columns with access status according to QUERY_ACCESS_CONFIG.',
    inputSchema: {
      type: 'object',
      properties: {
        database: databaseProperty,
        table: {
          type: 'string',
          description: 'Table name to check.',
        },
        schema: schemaProperty,
      },
      required: ['table'],
    },
  },
  ...(!appConfig.server.schemaOnlyMode
    ? [
        {
          name: 'execute_query',
          description:
            'Executes a guarded read-only MySQL SELECT query. Queries are validated, access-controlled, and automatically limited with LIMIT.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              database: databaseProperty,
              query: {
                type: 'string',
                description:
                  'Read-only SELECT query. Supports joins, CTEs, subqueries, WHERE, GROUP BY, HAVING, ORDER BY, and LIMIT.',
              },
              parameters: {
                type: 'object',
                description:
                  'Optional named parameters for mysql2 named placeholders, for example {"id": 123}.',
              },
            },
            required: ['query'],
          },
        },
      ]
    : []),
];

const server = new Server(
  {
    name: appConfig.server.name,
    version: appConfig.server.version,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    logger.info(`Tool called: ${name}`, args);

    switch (name) {
      case 'get_schema':
        return textResult(await getSchema(args as any));
      case 'get_table_info':
        return textResult(await getTableInfo(args as any));
      case 'find_tables':
        return textResult(await findTables(args as any));
      case 'search_objects':
        return textResult(await searchObjects(args as any));
      case 'get_relationships':
        return textResult(await getRelationships(args as any));
      case 'validate_objects': {
        const { database, table, tables, schema } = args as any;
        if (Array.isArray(tables)) {
          return textResult(
            await Promise.all(
              tables.map((candidate: string) =>
                validateDatabaseObject(database, candidate, schema),
              ),
            ),
          );
        }
        return textResult(await validateDatabaseObject(database, table, schema));
      }
      case 'get_accessible_schema':
        return textResult(await getAccessibleSchema(args as any));
      case 'get_accessible_table_info':
        return textResult(await getAccessibleTableInfo(args as any));
      case 'execute_query':
        if (appConfig.server.schemaOnlyMode) {
          throw new Error('Data query operations are disabled because SCHEMA_ONLY_MODE=true.');
        }
        return textResult(await executeQuery(args as any));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Error executing tool ${name}:`, error);
    return errorResult(error);
  }
});

async function main(): Promise<void> {
  try {
    await db.connect();

    if (appConfig.server.schemaOnlyMode) {
      logger.info('SCHEMA_ONLY_MODE enabled - execute_query is disabled');
    } else if (process.env.QUERY_ACCESS_CONFIG) {
      try {
        initAccessControl(loadAccessControlConfig());
        logger.info('Access control enabled for execute_query');
      } catch (error) {
        logger.error('Failed to load access control config:', error);
      }
    } else {
      logger.warn('QUERY_ACCESS_CONFIG not set - execute_query will be blocked');
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`${appConfig.server.name} v${appConfig.server.version} started`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

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
