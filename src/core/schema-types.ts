export interface ColumnMetadata {
  name: string;
  ordinal: number;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  defaultValue?: string | null;
  description?: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface PrimaryKeyMetadata {
  constraintName: string;
  columns: string;
}

export interface ForeignKeyMetadata {
  constraintName: string;
  fromSchema: string;
  fromTable: string;
  fromColumns: string;
  toSchema: string;
  toTable: string;
  toColumns: string;
  onDelete: string;
  onUpdate: string;
}

export interface IndexMetadata {
  name: string;
  type: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  columns: string;
}

export interface StatisticsMetadata {
  rowCount?: number;
  totalSizeKB?: number;
  usedSizeKB?: number;
}

export interface TableMetadata {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  columns: ColumnMetadata[];
  primaryKey?: PrimaryKeyMetadata;
  foreignKeys?: ForeignKeyMetadata[];
  indexes: IndexMetadata[];
  statistics?: StatisticsMetadata;
}

export interface SchemaResult {
  schema: TableMetadata[];
}
