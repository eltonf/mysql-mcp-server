import { db } from '../db/connection.js';
import { cache } from '../db/cache.js';
import { logger } from '../utils/logger.js';

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
  fromTable: string;
  toTable?: string;
  maxDepth?: number;
  schema?: string;
}): Promise<RelationshipPath[]> {
  const { fromTable, toTable, maxDepth = 2, schema = 'dbo' } = args;

  const cacheKey = `relationships:${schema}:${fromTable}:${toTable || 'all'}:${maxDepth}`;
  const cached = cache.get<RelationshipPath[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Get all foreign key relationships
    const relationships = await getAllRelationships(schema);

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

async function getAllRelationships(schema: string): Promise<Relationship[]> {
  const query = `
    SELECT
      s.name AS fromSchema,
      t.name AS fromTable,
      c.name AS fromColumn,
      rs.name AS toSchema,
      rt.name AS toTable,
      rc.name AS toColumn,
      fk.name AS constraintName,
      fk.delete_referential_action_desc AS deleteAction,
      fk.update_referential_action_desc AS updateAction
    FROM sys.foreign_keys fk
    INNER JOIN sys.tables t ON fk.parent_object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    INNER JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
    INNER JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
    INNER JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
    INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
    WHERE s.name = @schema OR rs.name = @schema
    ORDER BY t.name, fk.name
  `;

  const result = await db.query<Relationship>(query, { schema });
  return result.recordset;
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