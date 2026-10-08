export type Engine = "mysql" | "postgres" | "sqlite" | "mongodb" | "redis";
export interface Connection {
  id: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  uri?: string;
  filePath?: string;
  ssl: boolean;
  color: string;
  environment: "local" | "development" | "production";
  connected?: boolean;
}
export interface DbObject {
  name: string;
  schema?: string;
  type: "table" | "view" | "collection" | "key";
  keyType?: string;
  rowCount?: number;
  dataLength?: number;
  engine?: string;
  createdAt?: string;
  modifiedAt?: string;
  collation?: string;
  comment?: string;
  estimated?: boolean;
}
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: unknown;
  identity?: string;
  generationExpression?: string;
}
export interface ForeignKey {
  column: string;
  table: string;
  foreignColumn: string;
}
export interface TableInfo {
  columns: Column[];
  foreignKeys: ForeignKey[];
  indexes: { name: string; columns: string; unique: boolean }[];
}
export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affectedRows: number;
  elapsedMs: number;
  truncated?: boolean;
}
export interface TablePage extends QueryResult {
  total: number;
  page: number;
  pageSize: number;
}
export const filterOperators = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "between",
  "is_null",
  "is_not_null",
] as const;
export interface FilterCondition {
  column: string;
  operator: (typeof filterOperators)[number];
  value?: string;
  valueTo?: string;
}
export interface TableFilter {
  mode: "and" | "or";
  conditions: FilterCondition[];
}
export interface SavedQuery {
  id: string;
  name: string;
  text: string;
  connectionId: string;
  updatedAt: string;
}
export interface HistoryEntry {
  id: string;
  sql: string;
  connectionId: string;
  connectionName: string;
  timestamp: string;
  elapsedMs: number;
  rowCount: number;
  success: boolean;
  error?: string;
}
export interface SchemaDifference {
  field: string;
  kind: "missing" | "extra" | "changed";
  source: string;
  target: string;
  detail: string;
}
export interface SchemaComparison {
  source: TableInfo;
  target: TableInfo;
  differences: SchemaDifference[];
  sql: string;
  notes: string[];
}
export interface SyncChange {
  kind: "insert" | "update" | "delete";
  key: Record<string, unknown>;
  source?: Record<string, unknown>;
  target?: Record<string, unknown>;
  fields: string[];
}
export interface SyncPlan {
  id: string;
  sourceId: string;
  targetId: string;
  sourceObject: DbObject;
  targetObject: DbObject;
  changes: SyncChange[];
  unchanged: number;
  sourceCount: number;
  targetCount: number;
  primaryKeys: string[];
  columns: string[];
  expiresAt: string;
}
export interface DatabaseScope {
  connectionId: string;
  database: string;
}
export interface TablePair {
  source: DbObject;
  target: DbObject;
}
export interface DatabaseSchemaComparison {
  tables: (SchemaComparison & {
    sourceObject: DbObject;
    targetObject: DbObject;
  })[];
  sql: string;
}
export interface DatabaseSyncPlan {
  id: string;
  source: DatabaseScope;
  target: DatabaseScope;
  tables: SyncPlan[];
  expiresAt: string;
}
export interface Api {
  connections(): Promise<Connection[]>;
  saveConnection(connection: Connection): Promise<Connection>;
  removeConnection(id: string): Promise<void>;
  connect(connection: Connection): Promise<{ version: string }>;
  disconnect(id: string): Promise<void>;
  test(connection: Connection): Promise<{ version: string }>;
  databases(id: string): Promise<{ names: string[]; selected: string }>;
  selectDatabase(id: string, database: string): Promise<void>;
  dropDatabase(id: string, database: string): Promise<void>;
  databaseObjects(scope: DatabaseScope): Promise<DbObject[]>;
  objects(id: string): Promise<DbObject[]>;
  schema(id: string, object: DbObject): Promise<TableInfo>;
  table(
    id: string,
    object: DbObject,
    page: number,
    pageSize: number,
    sort?: string,
    direction?: string,
    filter?: string,
    conditions?: TableFilter,
  ): Promise<TablePage>;
  query(id: string, sql: string): Promise<QueryResult>;
  updateRow(
    id: string,
    object: DbObject,
    key: Record<string, unknown>,
    values: Record<string, unknown>,
  ): Promise<void>;
  insertRow(
    id: string,
    object: DbObject,
    values: Record<string, unknown>,
  ): Promise<void>;
  deleteRow(
    id: string,
    object: DbObject,
    key: Record<string, unknown>,
  ): Promise<void>;
  importRows(
    id: string,
    object: DbObject,
    rows: Record<string, unknown>[],
  ): Promise<{ imported: number }>;
  backup(id: string): Promise<{ filename: string; data: string }>;
  exportSql(
    id: string,
    object?: DbObject,
  ): Promise<{ filename: string; sql: string; tables: number; rows: number }>;
  importSql(
    id: string,
    script: string,
  ): Promise<{ statements: number; transactional: boolean }>;
  renameObject(id: string, object: DbObject, newName: string): Promise<void>;
  dropObject(id: string, object: DbObject): Promise<void>;
  compareSchemas(
    sourceId: string,
    targetId: string,
    sourceObject: DbObject,
    targetObject: DbObject,
  ): Promise<SchemaComparison>;
  compareData(
    sourceId: string,
    targetId: string,
    sourceObject: DbObject,
    targetObject: DbObject,
  ): Promise<SyncPlan>;
  applySync(
    planId: string,
    deleteExtra: boolean,
  ): Promise<{ inserted: number; updated: number; deleted: number }>;
  compareDatabaseSchemas(
    source: DatabaseScope,
    target: DatabaseScope,
    tables: TablePair[],
  ): Promise<DatabaseSchemaComparison>;
  compareDatabaseData(
    source: DatabaseScope,
    target: DatabaseScope,
    tables: TablePair[],
  ): Promise<DatabaseSyncPlan>;
  applyDatabaseSync(
    planId: string,
    deleteExtra: boolean,
  ): Promise<{ inserted: number; updated: number; deleted: number }>;
  pickFile(): Promise<string | null>;
}
