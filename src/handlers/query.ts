import { logger } from '../utils/logger.js';
import { getSchema } from './schema.js';
import { getRelationships } from './relationships.js';

interface QueryGenerationResult {
  sql: string;
  explanation: string;
  tables: string[];
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}

export async function generateQuery(args: {
  description: string;
  tables?: string[];
  outputFormat?: 'sql' | 'json';
  schema?: string;
}): Promise<QueryGenerationResult> {
  const { description, tables, schema = 'dbo' } = args;

  try {
    logger.info(`Generating query for: ${description}`);

    // Get schema information for context (for future enhancement)
    if (tables && tables.length > 0) {
      await getSchema({ tables, schema, includeRelationships: true });
    }

    // Analyze the description to determine query type
    const queryType = detectQueryType(description);
    const involvedTables = tables || extractTableNames(description);

    // Generate SQL based on description and context
    const sqlQuery = await buildQuery(description, involvedTables, schema, queryType);

    // Generate explanation
    const explanation = generateExplanation(sqlQuery, queryType, involvedTables);

    // Estimate complexity
    const estimatedComplexity = estimateComplexity(sqlQuery, involvedTables);

    return {
      sql: sqlQuery,
      explanation,
      tables: involvedTables,
      estimatedComplexity,
    };
  } catch (error) {
    logger.error('Error generating query:', error);
    throw error;
  }
}

function detectQueryType(description: string): string {
  const lower = description.toLowerCase();

  if (lower.includes('count') || lower.includes('how many')) {
    return 'aggregate';
  } else if (lower.includes('join') || lower.includes('combine') || lower.includes('relate')) {
    return 'join';
  } else if (lower.includes('group by') || lower.includes('grouped') || lower.includes('per')) {
    return 'group';
  } else if (lower.includes('order by') || lower.includes('sort') || lower.includes('top')) {
    return 'sorted';
  } else if (lower.includes('where') || lower.includes('filter') || lower.includes('match')) {
    return 'filtered';
  }

  return 'simple';
}

function extractTableNames(description: string): string[] {
  // Simple extraction - look for capitalized words that might be table names
  // In a real implementation, this would be more sophisticated
  const words = description.split(/\s+/);
  const possibleTables: string[] = [];

  for (const word of words) {
    const cleaned = word.replace(/[^a-zA-Z]/g, '');
    if (cleaned.length > 0 && cleaned[0] === cleaned[0].toUpperCase()) {
      possibleTables.push(cleaned);
    }
  }

  return possibleTables.length > 0 ? possibleTables : ['UnknownTable'];
}

async function buildQuery(
  description: string,
  tables: string[],
  schema: string,
  queryType: string
): Promise<string> {
  // This is a simplified query builder
  // In a production system, this would use the schema info and relationships
  // to generate more accurate queries

  const mainTable = tables[0];
  let query = `-- Query: ${description}\n`;
  query += `SELECT *\n`;
  query += `FROM ${schema}.${mainTable}\n`;

  // Add JOINs if multiple tables
  if (tables.length > 1) {
    // Try to find relationships between tables
    try {
      const relationships = await getRelationships({
        fromTable: mainTable,
        schema,
        maxDepth: tables.length,
      });

      if (relationships.length > 0) {
        query += relationships[0].joinCondition + '\n';
      }
    } catch (error) {
      logger.warn('Could not determine relationships for query generation');
      // Add basic joins without relationship info
      for (let i = 1; i < tables.length; i++) {
        query += `-- JOIN ${schema}.${tables[i]} ON [specify join condition]\n`;
      }
    }
  }

  // Add WHERE clause hints based on description
  const lower = description.toLowerCase();
  if (lower.includes('where') || lower.includes('filter')) {
    query += `WHERE [specify filter conditions based on: ${description}]\n`;
  }

  // Add GROUP BY hints
  if (queryType === 'group' || queryType === 'aggregate') {
    query += `-- GROUP BY [specify grouping columns]\n`;
  }

  // Add ORDER BY hints
  if (queryType === 'sorted') {
    query += `-- ORDER BY [specify sort columns]\n`;
  }

  query += `;\n\n`;
  query += `-- Note: This is a template query. Please review and adjust based on your specific requirements.`;

  return query;
}

function generateExplanation(_sqlQuery: string, queryType: string, tables: string[]): string {
  let explanation = `This query ${queryType === 'simple' ? 'retrieves data from' : 'performs a ' + queryType + ' operation on'} `;

  if (tables.length === 1) {
    explanation += `the ${tables[0]} table.`;
  } else {
    explanation += `${tables.length} tables: ${tables.join(', ')}.`;
  }

  if (queryType === 'join') {
    explanation += ' It combines data from multiple tables using JOIN operations based on foreign key relationships.';
  } else if (queryType === 'aggregate') {
    explanation += ' It performs aggregation functions to summarize data.';
  } else if (queryType === 'group') {
    explanation += ' It groups data by specific columns to provide grouped results.';
  }

  return explanation;
}

function estimateComplexity(sqlQuery: string, tables: string[]): 'simple' | 'moderate' | 'complex' {
  const joinCount = (sqlQuery.match(/JOIN/gi) || []).length;
  const subqueryCount = (sqlQuery.match(/SELECT.*FROM.*SELECT/gi) || []).length;

  if (subqueryCount > 0 || joinCount > 3 || tables.length > 4) {
    return 'complex';
  } else if (joinCount > 1 || tables.length > 2) {
    return 'moderate';
  }

  return 'simple';
}