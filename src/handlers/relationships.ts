import { db } from '../db/connection.js';
import { cache } from '../db/cache.js';
import { logger } from '../utils/logger.js';
import { buildGetRelationshipsQuery } from '../db/queries.js';

interface Relationship {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  constraintName: string;
  deleteAction: string;
  updateAction: string;
}

interface RelationshipPath {
  path: Relationship[];
  joinCondition: string;
}

export async function getRelationships(args: {
  database: string;
  fromTable: string;
  toTable?: string;
  maxDepth?: number;
  schema?: string;
}): Promise<RelationshipPath[]> {
  const { database, fromTable, toTable, maxDepth = 2, schema = 'dbo' } = args;

  const cacheKey = `relationships:${database}:${schema}:${fromTable}:${toTable || 'all'}:${maxDepth}`;
  const cached = cache.get<RelationshipPath[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Get all foreign key relationships
    const relationships = await getAllRelationships(database, schema);

    // Build relationship graph
    const paths: RelationshipPath[] = [];

    if (toTable) {
      // Find paths from fromTable to toTable
      const foundPaths = findPaths(fromTable, toTable, relationships, maxDepth);
      paths.push(...foundPaths);
    } else {
      // Return all direct relationships from fromTable
      const directRelationships = relationships.filter(
        r => r.fromTable === fromTable || r.toTable === fromTable
      );

      for (const rel of directRelationships) {
        paths.push({
          path: [rel],
          joinCondition: buildJoinCondition([rel]),
        });
      }
    }

    cache.set(cacheKey, paths);
    return paths;
  } catch (error) {
    logger.error('Error getting relationships:', error);
    throw error;
  }
}

async function getAllRelationships(database: string, schema: string): Promise<Relationship[]> {
  const query = buildGetRelationshipsQuery(database, schema);
  const result = await db.query<Relationship>(query);

  // Parse JSON result if needed
  let relationships: Relationship[];
  if (result.recordset.length === 1 && typeof result.recordset[0] === 'string') {
    relationships = JSON.parse(result.recordset[0] as any);
  } else if (result.recordset.length === 1 && (result.recordset[0] as any).JSON_F52E2B61_18A1_11d1_B105_00805F49916B) {
    // SQL Server returns JSON in a special column
    relationships = JSON.parse((result.recordset[0] as any).JSON_F52E2B61_18A1_11d1_B105_00805F49916B);
  } else {
    relationships = result.recordset;
  }

  return relationships;
}

function findPaths(
  fromTable: string,
  toTable: string,
  relationships: Relationship[],
  maxDepth: number
): RelationshipPath[] {
  const paths: RelationshipPath[] = [];
  const visited = new Set<string>();

  function dfs(currentTable: string, currentPath: Relationship[], depth: number) {
    if (depth > maxDepth) return;

    if (currentTable === toTable && currentPath.length > 0) {
      paths.push({
        path: [...currentPath],
        joinCondition: buildJoinCondition(currentPath),
      });
      return;
    }

    visited.add(currentTable);

    // Find outgoing relationships
    for (const rel of relationships) {
      if (rel.fromTable === currentTable && !visited.has(rel.toTable)) {
        currentPath.push(rel);
        dfs(rel.toTable, currentPath, depth + 1);
        currentPath.pop();
      }
    }

    // Find incoming relationships (reverse direction)
    for (const rel of relationships) {
      if (rel.toTable === currentTable && !visited.has(rel.fromTable)) {
        currentPath.push(rel);
        dfs(rel.fromTable, currentPath, depth + 1);
        currentPath.pop();
      }
    }

    visited.delete(currentTable);
  }

  dfs(fromTable, [], 0);
  return paths;
}

function buildJoinCondition(path: Relationship[]): string {
  if (path.length === 0) return '';

  const conditions: string[] = [];
  let currentTable = path[0].fromTable;

  for (let i = 0; i < path.length; i++) {
    const rel = path[i];

    if (rel.fromTable === currentTable) {
      // Forward relationship
      conditions.push(
        `JOIN ${rel.toSchema}.${rel.toTable} ON ${rel.fromSchema}.${rel.fromTable}.${rel.fromColumn} = ${rel.toSchema}.${rel.toTable}.${rel.toColumn}`
      );
      currentTable = rel.toTable;
    } else {
      // Reverse relationship
      conditions.push(
        `JOIN ${rel.fromSchema}.${rel.fromTable} ON ${rel.toSchema}.${rel.toTable}.${rel.toColumn} = ${rel.fromSchema}.${rel.fromTable}.${rel.fromColumn}`
      );
      currentTable = rel.fromTable;
    }
  }

  return conditions.join('\n');
}