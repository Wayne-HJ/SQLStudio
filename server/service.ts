import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import mysql from "mysql2/promise";
import pg from "pg";
import { MongoClient } from "mongodb";
import { createClient } from "redis";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import {
  fingerprint,
  schemaDifferences,
  typeFamily,
  stable,
} from "./compare.js";
import { compareRows } from "./compare.js";
import { splitSql, stripComments, sqlLiteral } from "./sql-files.js";
import { buildTableFilter } from "./table-filter.js";
import { ConnectionStore } from "./store.js";
import { seedDemo } from "./demo.js";
import type {
  Connection,
  DbObject,
  TableInfo,
  QueryResult,
  TablePage,
  SchemaComparison,
  SyncPlan,
  Column,
  TableFilter,
  DatabaseScope,
  TablePair,
  DatabaseSchemaComparison,
  DatabaseSyncPlan,
} from "../shared/types.js";

interface Session {
  config: Connection;
  client: any;
  sqlite?: Database;
  version: string;
  sqliteHash?: string;
  sqliteInvalidated?: boolean;
}
interface SyncEntry {
  plan: SyncPlan;
  sourceHash: string;
  targetHash: string;
}
export const demoConnection: Connection = {
  id: "demo",
  name: "Commerce · 示例数据库",
  engine: "sqlite",
  host: "",
  port: 0,
  database: "commerce.db",
  username: "",
  ssl: false,
  color: "#5b7cfa",
  environment: "local",
};
export class DatabaseService {
  private sessions = new Map<string, Session>();
  private transient = new Map<string, Connection>();
  private syncPlans = new Map<string, SyncEntry>();
  private databaseSyncPlans = new Map<
    string,
    { plan: DatabaseSyncPlan; entries: SyncEntry[] }
  >();
  constructor(
    private directory: string,
    private store = new ConnectionStore(directory),
  ) {}
  async connections() {
    return [demoConnection, ...(await this.store.list())].map((c) =>
      this.publicConnection(c),
    );
  }
  private publicConnection(c: Connection) {
    const { password, uri, ...safe } = c;
    return {
      ...safe,
      connected:
        this.sessions.has(c.id) && !this.sessions.get(c.id)?.sqliteInvalidated,
    };
  }
  async saveConnection(config: Connection) {
    if (config.id === "demo") throw new Error("示例连接不能被覆盖");
    const existing = (await this.store.list()).find((c) => c.id === config.id);
    const previous = this.transient.get(config.id) ?? existing;
    const merged = {
      ...config,
      password: config.password ?? previous?.password,
      uri: config.uri ?? previous?.uri,
    };
    if (this.sessions.has(config.id)) await this.disconnect(config.id);
    this.transient.set(config.id, merged);
    await this.store.save(merged);
    return this.publicConnection(merged);
  }
  async removeConnection(id: string) {
    if (id === "demo") throw new Error("示例连接不能删除");
    await this.disconnect(id);
    this.transient.delete(id);
    await this.store.remove(id);
  }
  async connect(config: Connection) {
    if (this.sessions.get(config.id)?.sqliteInvalidated)
      await this.disconnect(config.id);
    if (this.sessions.has(config.id))
      return { version: this.sessions.get(config.id)!.version };
    const stored =
      this.transient.get(config.id) ??
      (await this.store.list()).find((c) => c.id === config.id);
    const merged = {
      ...stored,
      ...config,
      password: config.password ?? stored?.password,
      uri: config.uri ?? stored?.uri,
    };
    if (config.id === "demo")
      merged.filePath = path.join(this.directory, "commerce.db");
    const session = await this.open(merged);
    this.sessions.set(config.id, session);
    return { version: session.version };
  }
  async test(config: Connection) {
    const existing =
      this.transient.get(config.id) ??
      (await this.store.list()).find((c) => c.id === config.id);
    const session = await this.open({
      ...config,
      password: config.password ?? existing?.password,
      uri: config.uri ?? existing?.uri,
      id: "test-" + config.id,
    });
    try {
      return { version: session.version };
    } finally {
      await this.close(session, false);
    }
  }
  async disconnect(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id);
      await this.close(session);
    }
  }
  async shutdown() {
    await Promise.all(
      [...this.sessions.keys()].map((id) => this.disconnect(id)),
    );
  }
  private get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error("请先连接数据库");
    if (session.sqliteInvalidated)
      throw new Error("SQLite 文件连接已失效，请重新连接数据库。");
    return session;
  }
  private async open(config: Connection): Promise<Session> {
    let client: any;
    let sqlite: Database | undefined;
    let version = "";
    let sqliteHash: string | undefined;
    try {
      switch (config.engine) {
        case "sqlite": {
          const SQL = await initSqlJs({
            locateFile: (file) =>
              createRequire(import.meta.url).resolve(`sql.js/dist/${file}`),
          });
          const filename = config.filePath;
          let buffer: Buffer | undefined;
          if (filename) {
            await this.assertSqliteFile(filename);
            try {
              buffer = await fs.readFile(filename);
            } catch (error: any) {
              if (error.code !== "ENOENT") throw error;
            }
          }
          sqlite = new SQL.Database(buffer);
          client = sqlite;
          sqlite.run("PRAGMA foreign_keys=ON;");
          if (config.id === "demo" && !buffer) {
            seedDemo(sqlite);
            await fs.mkdir(this.directory, { recursive: true });
            await fs.writeFile(filename!, sqlite.export());
            buffer = Buffer.from(sqlite.export());
          }
          if (buffer)
            sqliteHash = createHash("sha256").update(buffer).digest("hex");
          version = String(
            sqlite.exec("SELECT sqlite_version() AS version")[0].values[0][0],
          );
          break;
        }
        case "mysql": {
          client = await mysql.createConnection({
            host: config.host,
            port: config.port,
            user: config.username,
            password: config.password,
            database: config.database || undefined,
            ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
            connectTimeout: 10000,
            multipleStatements: false,
            dateStrings: true,
            supportBigNumbers: true,
            bigNumberStrings: true,
          });
          client.on("error", () => this.sessions.delete(config.id));
          const [rows] = await client.query("SELECT VERSION() AS version");
          version = rows[0].version;
          break;
        }
        case "postgres": {
          client = new pg.Client({
            host: config.host,
            port: config.port,
            user: config.username,
            password: config.password,
            database: config.database,
            ssl: config.ssl ? { rejectUnauthorized: true } : false,
            connectionTimeoutMillis: 10000,
            statement_timeout: 30000,
          });
          client.on("error", () => {
            this.sessions.delete(config.id);
          });
          await client.connect();
          version = (await client.query("SHOW server_version")).rows[0]
            .server_version;
          break;
        }
        case "mongodb": {
          const credentials = config.username
            ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password ?? "")}@`
            : "";
          const uri =
            config.uri ||
            `mongodb://${credentials}${config.host}:${config.port}/${encodeURIComponent(config.database)}`;
          client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 10000,
            tls: config.ssl || uri.startsWith("mongodb+srv://"),
          });
          await client.connect();
          await client.db(config.database || undefined).command({ ping: 1 });
          version = "MongoDB";
          break;
        }
        case "redis": {
          client = createClient({
            socket: {
              host: config.host,
              port: config.port,
              connectTimeout: 10000,
              reconnectStrategy: false,
              ...(config.ssl ? { tls: true as const } : {}),
            },
            username: config.username || undefined,
            password: config.password || undefined,
            database: Number(config.database) || 0,
          });
          client.on("error", () => {
            this.sessions.delete(config.id);
          });
          await client.connect();
          version =
            (await client.info("server")).match(
              /redis_version:([^\r\n]+)/,
            )?.[1] ?? "Redis";
          break;
        }
      }
      return { config, client, sqlite, version, sqliteHash };
    } catch (error) {
      if (client) {
        try {
          if (config.engine === "redis") client.destroy();
          else if (config.engine === "sqlite") client.close();
          else if (config.engine === "mongodb") await client.close();
          else await client.end();
        } catch {}
      }
      throw error;
    }
  }
  private async close(s: Session, persist = true) {
    if (s.sqlite) {
      try {
        if (persist && !s.sqliteInvalidated) await this.persist(s);
      } finally {
        s.sqlite.close();
      }
    } else if (s.config.engine === "mongodb") await s.client.close();
    else if (s.config.engine === "redis") {
      if (s.client.isOpen) await s.client.quit();
    } else await s.client.end();
  }
  private async persist(s: Session) {
    if (s.sqlite && s.config.filePath) {
      try {
        await this.assertSqliteFile(s.config.filePath);
        let existing: Buffer | undefined;
        try {
          existing = await fs.readFile(s.config.filePath);
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
        }
        if (
          (existing
            ? createHash("sha256").update(existing).digest("hex")
            : undefined) !== s.sqliteHash
        )
          throw new Error(
            "SQLite 文件已被其他进程修改。已阻止覆盖，请断开后重新连接。",
          );
        const data = Buffer.from(s.sqlite.export());
        const hash = createHash("sha256").update(data).digest("hex");
        if (hash === s.sqliteHash) return;
        await fs.mkdir(path.dirname(s.config.filePath), { recursive: true });
        const temporary = s.config.filePath + ".sqlstudio-tmp";
        await fs.writeFile(temporary, data);
        await fs.rename(temporary, s.config.filePath);
        s.sqliteHash = hash;
      } catch (error) {
        s.sqliteInvalidated = true;
        throw error;
      }
    }
  }
  private async assertSqliteFile(filename: string) {
    try {
      const wal = await fs.stat(filename + "-wal");
      if (wal.size > 0)
        throw new Error(
          "SQLite 文件存在未合并的 WAL 日志。请关闭其他客户端并完成 checkpoint 后重新连接。",
        );
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  private quote(s: Session, name: string) {
    const q = s.config.engine === "mysql" ? "`" : '"';
    return q + name.replaceAll(q, q + q) + q;
  }
  private tableName(s: Session, o: DbObject) {
    return o.schema && ["postgres", "mysql"].includes(s.config.engine)
      ? `${this.quote(s, o.schema)}.${this.quote(s, o.name)}`
      : this.quote(s, o.name);
  }
  private async sql(
    s: Session,
    text: string,
    params: unknown[] = [],
    rowLimit = 1000,
  ): Promise<QueryResult> {
    const started = performance.now();
    let rows: Record<string, unknown>[] = [];
    let columns: string[] = [];
    let affectedRows = 0;
    if (s.sqlite) {
      if (params.length) {
        const statement = s.sqlite.prepare(text);
        try {
          statement.bind(params as any);
          while (statement.step()) {
            rows.push(statement.getAsObject());
          }
          columns = statement.getColumnNames();
          affectedRows = s.sqlite.getRowsModified();
        } finally {
          statement.free();
        }
      } else {
        const result = s.sqlite.exec(text);
        const last = result.at(-1);
        if (last) {
          columns = last.columns;
          rows = last.values.map((row) =>
            Object.fromEntries(columns.map((column, i) => [column, row[i]])),
          );
        }
        affectedRows = s.sqlite.getRowsModified();
      }
    } else if (s.config.engine === "mysql") {
      const [result, fields] = await s.client.query(
        { sql: text, timeout: 30000 },
        params,
      );
      if (Array.isArray(result)) {
        rows = result;
        columns = fields.map((f: any) => f.name);
      } else affectedRows = result.affectedRows ?? 0;
    } else if (s.config.engine === "postgres") {
      const result = await s.client.query(text, params);
      const last = Array.isArray(result) ? result.at(-1) : result;
      rows = last.rows;
      columns = last.fields.map((f: any) => f.name);
      affectedRows = columns.length ? 0 : (last.rowCount ?? 0);
    } else throw new Error("此数据库不支持 SQL");
    return {
      columns,
      rows: rows.slice(0, rowLimit),
      affectedRows: columns.length ? 0 : affectedRows,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      truncated: rows.length > rowLimit,
    };
  }
  async databases(id: string) {
    const s = this.get(id);
    if (s.config.engine === "postgres") {
      const names = (
        await this.sql(
          s,
          "SELECT datname AS name FROM pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(datname, 'CONNECT') ORDER BY datname",
          [],
          Infinity,
        )
      ).rows.map((row) => String(row.name));
      return { names, selected: s.config.database };
    }
    if (s.config.engine !== "mysql")
      return { names: [s.config.database], selected: s.config.database };
    const names = (await this.sql(s, "SHOW DATABASES", [], Infinity)).rows.map(
      (row) => String(row.Database),
    );
    const current = (await this.sql(s, "SELECT DATABASE() AS name")).rows[0]
      ?.name;
    const selected = typeof current === "string" ? current : "";
    // Keep USE statements from the query editor in sync with the browser.
    s.config = { ...s.config, database: selected };
    return { names, selected };
  }
  async selectDatabase(id: string, database: string) {
    const s = this.get(id);
    if (!database) throw new Error("请选择数据库");
    if (s.config.engine === "postgres") {
      const next = await this.open({ ...s.config, database });
      this.sessions.set(id, next);
      await this.close(s);
      return;
    }
    if (s.config.engine !== "mysql") throw new Error("此连接不支持切换数据库");
    await this.sql(s, `USE ${this.quote(s, database)}`);
    // Update only the session; the saved default may intentionally be blank.
    s.config = { ...s.config, database };
  }
  // Scoped operations leave the database selected in the object browser intact.
  private async inDatabase<T>(
    scope: DatabaseScope,
    run: (id: string) => Promise<T>,
  ): Promise<T> {
    const base = this.get(scope.connectionId);
    if (!scope.database) throw new Error("请选择数据库");
    if (base.config.database === scope.database) return run(scope.connectionId);
    if (!["mysql", "postgres"].includes(base.config.engine))
      throw new Error("此连接不支持切换数据库");
    const id = randomUUID();
    const scoped =
      base.config.engine === "mysql"
        ? { ...base, config: { ...base.config, database: scope.database } }
        : await this.open({ ...base.config, id, database: scope.database });
    this.sessions.set(id, scoped);
    try {
      return await run(id);
    } finally {
      this.sessions.delete(id);
      if (base.config.engine !== "mysql") await this.close(scoped, false);
    }
  }
  async databaseObjects(scope: DatabaseScope) {
    return this.inDatabase(scope, (id) => this.objects(id));
  }
  async dropDatabase(id: string, database: string) {
    const s = this.get(id);
    if (!database) throw new Error("请选择数据库");
    if (id === "demo") throw new Error("示例数据库不能删除");
    if (s.config.engine === "mysql") {
      if (
        ["mysql", "information_schema", "performance_schema", "sys"].includes(
          database.toLowerCase(),
        )
      )
        throw new Error("系统数据库不能删除");
      await this.sql(s, `DROP DATABASE ${this.quote(s, database)}`);
      for (const session of this.sessions.values())
        if (
          session.config.engine === "mysql" &&
          session.config.host === s.config.host &&
          session.config.port === s.config.port &&
          session.config.database === database
        )
          session.config = { ...session.config, database: "" };
    } else if (s.config.engine === "postgres") {
      if (
        ["postgres", "template0", "template1"].includes(database.toLowerCase())
      )
        throw new Error("系统数据库不能删除");
      const maintenance = await this.open({
        ...s.config,
        id: randomUUID(),
        database: "postgres",
      });
      const disconnected: { id: string; config: Connection }[] = [];
      try {
        for (const [sessionId, session] of this.sessions)
          if (
            session.config.engine === "postgres" &&
            session.config.host === s.config.host &&
            session.config.port === s.config.port &&
            session.config.database === database
          ) {
            disconnected.push({ id: sessionId, config: session.config });
            await this.disconnect(sessionId);
          }
        await this.sql(
          maintenance,
          `DROP DATABASE ${this.quote(maintenance, database)}`,
        );
      } catch (error) {
        // A server-side refusal (for example, another client is connected)
        // must not leave our previously open database connections unusable.
        for (const previous of disconnected) {
          const restored = await this.open(previous.config).catch(
            () => undefined,
          );
          if (restored) this.sessions.set(previous.id, restored);
        }
        throw error;
      } finally {
        await this.close(maintenance, false);
      }
    } else if (s.config.engine === "sqlite") {
      if (database !== s.config.database || !s.config.filePath)
        throw new Error("请选择数据库");
      const filename = path.resolve(s.config.filePath);
      if (filename === path.resolve(this.directory, "commerce.db"))
        throw new Error("示例数据库不能删除");
      await this.assertSqliteFile(filename);
      const current = await fs.readFile(filename);
      if (createHash("sha256").update(current).digest("hex") !== s.sqliteHash)
        throw new Error("SQLite 文件已被其他进程修改，请断开后重新连接。");
      // Close without persistence so shutdown cannot recreate the deleted file.
      for (const [sessionId, session] of this.sessions)
        if (
          session.sqlite &&
          session.config.filePath &&
          path.resolve(session.config.filePath) === filename
        ) {
          this.sessions.delete(sessionId);
          await this.close(session, false);
        }
      await fs.unlink(filename);
    } else if (s.config.engine === "mongodb") {
      if (["admin", "config", "local"].includes(database.toLowerCase()))
        throw new Error("系统数据库不能删除");
      await s.client.db(database).dropDatabase();
    } else {
      if (database !== s.config.database) throw new Error("请选择数据库");
      await s.client.flushDb();
    }
    this.syncPlans.clear();
    this.databaseSyncPlans.clear();
    if (["mysql", "postgres"].includes(s.config.engine)) {
      const fallback = s.config.engine === "postgres" ? "postgres" : "";
      for (const config of await this.store.list())
        if (
          config.engine === s.config.engine &&
          config.host === s.config.host &&
          config.port === s.config.port &&
          config.database === database
        ) {
          const updated = { ...config, database: fallback };
          await this.store.save(updated);
          const transient = this.transient.get(config.id);
          if (transient)
            this.transient.set(config.id, { ...transient, database: fallback });
        }
    }
  }
  async objects(id: string): Promise<DbObject[]> {
    const s = this.get(id);
    if (s.config.engine === "sqlite") {
      const objects = (
        await this.sql(
          s,
          "SELECT name,type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
        )
      ).rows as unknown as DbObject[];
      for (const object of objects) {
        try {
          object.rowCount = Number(
            (
              await this.sql(
                s,
                `SELECT COUNT(*) AS count FROM ${this.tableName(s, object)}`,
              )
            ).rows[0]?.count ?? 0,
          );
        } catch {}
        object.engine = "SQLite";
      }
      return objects;
    }
    if (s.config.engine === "mysql") {
      if (!s.config.database) return [];
      return (
        await this.sql(
          s,
          "SELECT TABLE_NAME AS name, IF(TABLE_TYPE='VIEW','view','table') AS type,TABLE_ROWS AS rowCount,DATA_LENGTH AS dataLength,ENGINE AS engine,CREATE_TIME AS createdAt,UPDATE_TIME AS modifiedAt,TABLE_COLLATION AS collation,TABLE_COMMENT AS comment,true AS estimated FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME",
          [s.config.database],
        )
      ).rows.map((row) => ({
        ...row,
        schema: s.config.database,
      })) as unknown as DbObject[];
    }
    if (s.config.engine === "postgres") {
      return (
        await this.sql(
          s,
          "SELECT t.table_name AS name, t.table_schema AS schema, CASE WHEN t.table_type='VIEW' THEN 'view' ELSE 'table' END AS type,s.n_live_tup::int AS \"rowCount\", 'PostgreSQL' AS engine,true AS estimated FROM information_schema.tables t LEFT JOIN pg_stat_user_tables s ON s.schemaname=t.table_schema AND s.relname=t.table_name WHERE t.table_schema NOT IN ('pg_catalog','information_schema') ORDER BY t.table_schema,t.table_name",
        )
      ).rows as unknown as DbObject[];
    }
    if (s.config.engine === "mongodb")
      return (
        await s.client
          .db(s.config.database || undefined)
          .listCollections()
          .toArray()
      ).map((c: any) => ({ name: c.name, type: "collection" }));
    const keys: DbObject[] = [];
    let cursor = "0";
    do {
      const result = await s.client.scan(cursor, { COUNT: 200 });
      cursor = result.cursor;
      for (const name of result.keys) {
        keys.push({ name, type: "key" });
        if (keys.length >= 2000) break;
      }
    } while (cursor !== "0" && keys.length < 2000);
    return keys.sort((a, b) => a.name.localeCompare(b.name));
  }
  async schema(id: string, o: DbObject): Promise<TableInfo> {
    const s = this.get(id);
    const info: TableInfo = { columns: [], foreignKeys: [], indexes: [] };
    if (s.sqlite) {
      info.columns = (
        await this.sql(s, `PRAGMA table_info(${this.quote(s, o.name)})`)
      ).rows.map((c) => ({
        name: String(c.name),
        type: String(c.type),
        nullable: !c.notnull && !c.pk,
        primaryKey: !!c.pk,
        defaultValue: c.dflt_value,
      }));
      info.foreignKeys = (
        await this.sql(s, `PRAGMA foreign_key_list(${this.quote(s, o.name)})`)
      ).rows.map((c) => ({
        column: String(c.from),
        table: String(c.table),
        foreignColumn: String(c.to),
      }));
      const indexes = (
        await this.sql(s, `PRAGMA index_list(${this.quote(s, o.name)})`)
      ).rows;
      for (const i of indexes) {
        const cols = (
          await this.sql(
            s,
            `PRAGMA index_info(${this.quote(s, String(i.name))})`,
          )
        ).rows;
        info.indexes.push({
          name: String(i.name),
          columns: cols.map((c) => c.name).join(", "),
          unique: !!i.unique,
        });
      }
    } else if (s.config.engine === "mysql") {
      info.columns = (
        await this.sql(
          s,
          "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_KEY AS pk,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
          [o.schema || s.config.database, o.name],
        )
      ).rows.map((c) => ({
        ...c,
        nullable: c.nullable === "YES",
        primaryKey: c.pk === "PRI",
      })) as any;
      info.foreignKeys = (
        await this.sql(
          s,
          "SELECT COLUMN_NAME AS `column`,REFERENCED_TABLE_NAME AS `table`,REFERENCED_COLUMN_NAME AS foreignColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL",
          [o.schema || s.config.database, o.name],
        )
      ).rows as any;
      const indexes = (
        await this.sql(
          s,
          "SELECT INDEX_NAME AS name,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS `columns`,MIN(NON_UNIQUE) AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? GROUP BY INDEX_NAME ORDER BY INDEX_NAME",
          [o.schema || s.config.database, o.name],
        )
      ).rows;
      info.indexes = indexes.map((i) => ({
        name: String(i.name),
        columns: String(i.columns),
        unique: !i.nonUnique,
      }));
    } else if (s.config.engine === "postgres") {
      info.columns = (
        await this.sql(
          s,
          `SELECT c.column_name AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,c.is_nullable AS nullable,c.column_default AS "defaultValue",c.identity_generation AS identity,c.generation_expression AS "generationExpression",EXISTS(SELECT 1 FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON t.constraint_name=k.constraint_name AND t.table_schema=k.table_schema WHERE t.constraint_type='PRIMARY KEY' AND k.table_schema=c.table_schema AND k.table_name=c.table_name AND k.column_name=c.column_name) AS pk FROM information_schema.columns c JOIN pg_namespace ns ON ns.nspname=c.table_schema JOIN pg_class rel ON rel.relnamespace=ns.oid AND rel.relname=c.table_name JOIN pg_attribute a ON a.attrelid=rel.oid AND a.attname=c.column_name WHERE c.table_schema=$1 AND c.table_name=$2 ORDER BY c.ordinal_position`,
          [o.schema || "public", o.name],
        )
      ).rows.map((c) => ({
        ...c,
        nullable: c.nullable === "YES",
        primaryKey: !!c.pk,
      })) as any;
      info.foreignKeys = (
        await this.sql(
          s,
          `SELECT a.attname AS "column",foreign_rel.relname AS "table",foreign_a.attname AS "foreignColumn" FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace JOIN pg_class foreign_rel ON foreign_rel.oid=c.confrelid CROSS JOIN LATERAL unnest(c.conkey,c.confkey) AS keys(attnum,foreign_attnum) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=keys.attnum JOIN pg_attribute foreign_a ON foreign_a.attrelid=c.confrelid AND foreign_a.attnum=keys.foreign_attnum WHERE c.contype='f' AND ns.nspname=$1 AND rel.relname=$2 ORDER BY c.conname,a.attnum`,
          [o.schema || "public", o.name],
        )
      ).rows as any;
      info.indexes = (
        await this.sql(
          s,
          "SELECT indexname AS name,indexdef AS columns FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 ORDER BY indexname",
          [o.schema || "public", o.name],
        )
      ).rows.map((i) => ({
        name: String(i.name),
        columns: String(i.columns),
        unique: String(i.columns).includes("UNIQUE"),
      }));
    } else if (s.config.engine === "mongodb") {
      const row = await s.client
        .db(s.config.database || undefined)
        .collection(o.name)
        .findOne();
      if (row)
        info.columns = Object.entries(row).map(([name, value]) => ({
          name,
          type: Array.isArray(value) ? "array" : typeof value,
          nullable: true,
          primaryKey: name === "_id",
        }));
    }
    return info;
  }
  async table(
    id: string,
    o: DbObject,
    page = 1,
    pageSize = 50,
    sort?: string,
    direction = "asc",
    filter = "",
    conditions?: TableFilter,
  ): Promise<TablePage> {
    const s = this.get(id);
    if (
      conditions?.conditions.length &&
      ["mongodb", "redis"].includes(s.config.engine)
    )
      throw new Error("按列筛选适用于关系型数据库，请使用当前数据库的筛选方式");
    page = Math.max(1, page);
    pageSize = Math.min(500, Math.max(1, pageSize));
    const offset = (page - 1) * pageSize;
    if (s.config.engine === "mongodb") {
      const started = performance.now();
      let query = {};
      if (filter) {
        try {
          query = JSON.parse(filter);
        } catch {
          throw new Error(
            'MongoDB 筛选器需要 JSON 对象，例如 {"status":"active"}',
          );
        }
      }
      const collection = s.client
        .db(s.config.database || undefined)
        .collection(o.name);
      let cursor = collection
        .find(query)
        .skip(offset)
        .limit(pageSize)
        .maxTimeMS(30000);
      if (sort) cursor = cursor.sort({ [sort]: direction === "desc" ? -1 : 1 });
      const rows = await cursor.toArray();
      return {
        columns: [...new Set<string>(rows.flatMap((r: any) => Object.keys(r)))],
        rows: JSON.parse(JSON.stringify(rows)),
        total: await collection.countDocuments(query, { maxTimeMS: 30000 }),
        page,
        pageSize,
        affectedRows: 0,
        elapsedMs: performance.now() - started,
      };
    }
    if (s.config.engine === "redis") {
      const started = performance.now();
      const type = await s.client.type(o.name);
      let value: unknown;
      if (type === "string") value = await s.client.get(o.name);
      else if (type === "hash") value = await s.client.hGetAll(o.name);
      else if (type === "list")
        value = await s.client.lRange(o.name, offset, offset + pageSize - 1);
      else if (type === "set")
        value = (await s.client.sScan(o.name, "0", { COUNT: pageSize }))
          .members;
      else if (type === "zset")
        value = await s.client.zRangeWithScores(
          o.name,
          offset,
          offset + pageSize - 1,
        );
      else value = `${type}：请使用命令编辑器查询`;
      return {
        columns: ["key", "type", "ttl", "value"],
        rows: [{ key: o.name, type, ttl: await s.client.ttl(o.name), value }],
        total: 1,
        page: 1,
        pageSize,
        affectedRows: 0,
        elapsedMs: performance.now() - started,
      };
    }
    const info = await this.schema(id, o);
    const names = info.columns.map((c) => c.name);
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filter && names.length) {
      clauses.push(
        names
          .map((name) => {
            params.push(`%${filter}%`);
            const placeholder =
              s.config.engine === "postgres" ? `$${params.length}` : "?";
            return `CAST(${this.quote(s, name)} AS ${s.config.engine === "mysql" ? "CHAR" : "TEXT"}) LIKE ${placeholder}`;
          })
          .join(" OR "),
      );
    }
    if (conditions?.conditions.length) {
      const built = buildTableFilter(
        conditions,
        info.columns,
        s.config.engine,
        params.length,
      );
      if (built.clause) clauses.push(built.clause);
      params.push(...built.params);
    }
    const where = clauses.length
      ? " WHERE " + clauses.map((clause) => `(${clause})`).join(" AND ")
      : "";
    const count = await this.sql(
      s,
      `SELECT COUNT(*) AS total FROM ${this.tableName(s, o)}${where}`,
      params,
    );
    const order =
      sort && names.includes(sort)
        ? ` ORDER BY ${this.quote(s, sort)} ${direction === "desc" ? "DESC" : "ASC"}`
        : "";
    const result = await this.sql(
      s,
      `SELECT * FROM ${this.tableName(s, o)}${where}${order} LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return {
      ...result,
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }
  async query(id: string, text: string): Promise<QueryResult> {
    const s = this.get(id);
    if (!text.trim()) throw new Error("请输入查询语句");
    const executable = text.replace(
      /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`/g,
      " ",
    );
    if (
      executable
        .split(";")
        .some((statement) =>
          /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT)\b/i.test(
            statement,
          ),
        )
    )
      throw new Error(
        "首版事务由导入和同步工具管理，查询编辑器暂不支持手动事务控制。",
      );
    const started = performance.now();
    if (s.config.engine === "mongodb") {
      const command = JSON.parse(text);
      const collection = s.client
        .db(s.config.database || undefined)
        .collection(command.collection);
      let result: any;
      switch (command.operation) {
        case "find":
          result = await collection
            .find(command.filter ?? {}, { projection: command.projection })
            .limit(Math.min(command.limit ?? 100, 1000))
            .maxTimeMS(30000)
            .toArray();
          break;
        case "count":
          result = [
            {
              count: await collection.countDocuments(command.filter ?? {}, {
                maxTimeMS: 30000,
              }),
            },
          ];
          break;
        case "aggregate":
          if (!Array.isArray(command.pipeline))
            throw new Error("pipeline 必须是数组");
          if (
            command.pipeline.some(
              (stage: any) => "$out" in stage || "$merge" in stage,
            )
          )
            throw new Error("首版聚合仅支持读取，请移除 $out / $merge");
          result = await collection
            .aggregate([...command.pipeline, { $limit: 1000 }], {
              maxTimeMS: 30000,
            })
            .toArray();
          break;
        case "insertOne":
          result = [await collection.insertOne(command.document)];
          break;
        case "updateOne":
          result = [await collection.updateOne(command.filter, command.update)];
          break;
        case "deleteOne":
          result = [await collection.deleteOne(command.filter)];
          break;
        default:
          throw new Error(
            "支持 find、count、aggregate、insertOne、updateOne、deleteOne",
          );
      }
      const rows = JSON.parse(JSON.stringify(result));
      return {
        rows,
        columns: [...new Set<string>(rows.flatMap((r: any) => Object.keys(r)))],
        affectedRows: 0,
        elapsedMs: performance.now() - started,
      };
    }
    if (s.config.engine === "redis") {
      const tokens = text.trim().startsWith("[")
        ? JSON.parse(text)
        : (text.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? []).map((t) =>
            t.startsWith('"')
              ? JSON.parse(t)
              : t.startsWith("'")
                ? t.slice(1, -1)
                : t,
          );
      if (
        !Array.isArray(tokens) ||
        !tokens.length ||
        tokens.some((t) => typeof t !== "string")
      )
        throw new Error("Redis 命令应为字符串参数数组");
      const forbidden = [
        "QUIT",
        "AUTH",
        "SELECT",
        "MULTI",
        "EXEC",
        "DISCARD",
        "SUBSCRIBE",
        "PSUBSCRIBE",
        "MONITOR",
        "SHUTDOWN",
        "CLIENT",
        "CONFIG",
        "DEBUG",
        "FLUSHALL",
        "FLUSHDB",
      ];
      if (forbidden.includes(tokens[0].toUpperCase()))
        throw new Error("首版不支持此连接控制 / 全库管理命令");
      const result = await s.client.sendCommand(tokens);
      return {
        columns: ["result"],
        rows: [{ result }],
        affectedRows: 0,
        elapsedMs: performance.now() - started,
      };
    }
    const result = await this.sql(s, text);
    await this.persist(s);
    return result;
  }
  private async writable(
    id: string,
    o: DbObject,
    values: Record<string, unknown>,
    key?: Record<string, unknown>,
  ) {
    const s = this.get(id);
    if (
      !["sqlite", "mysql", "postgres"].includes(s.config.engine) ||
      o.type !== "table"
    )
      throw new Error(
        "数据网格写入仅支持关系型数据库的表；其他类型请使用命令编辑器",
      );
    const info = await this.schema(id, o);
    const names = info.columns.map((c) => c.name);
    if (
      !Object.keys(values).length ||
      Object.keys(values).some((c) => !names.includes(c))
    )
      throw new Error("字段无效或没有提供字段");
    if (key) {
      const primary = info.columns
        .filter((c) => c.primaryKey)
        .map((c) => c.name);
      if (
        !primary.length ||
        primary.length !== Object.keys(key).length ||
        primary.some((c) => !(c in key) || key[c] === null)
      )
        throw new Error("为避免误修改，数据编辑需要完整主键");
    }
    return s;
  }
  private bind(s: Session, index: number) {
    return s.config.engine === "postgres" ? `$${index}` : "?";
  }
  private where(s: Session, key: Record<string, unknown>, offset = 0) {
    return Object.keys(key)
      .map((k, i) => `${this.quote(s, k)}=${this.bind(s, offset + i + 1)}`)
      .join(" AND ");
  }
  async updateRow(
    id: string,
    o: DbObject,
    key: Record<string, unknown>,
    values: Record<string, unknown>,
  ) {
    const s = await this.writable(id, o, values, key);
    await this.sql(
      s,
      `UPDATE ${this.tableName(s, o)} SET ${Object.keys(values)
        .map((c, i) => `${this.quote(s, c)}=${this.bind(s, i + 1)}`)
        .join(",")} WHERE ${this.where(s, key, Object.keys(values).length)}`,
      [...Object.values(values), ...Object.values(key)],
    );
    await this.persist(s);
  }
  async deleteRow(id: string, o: DbObject, key: Record<string, unknown>) {
    const s = await this.writable(id, o, key, key);
    await this.sql(
      s,
      `DELETE FROM ${this.tableName(s, o)} WHERE ${this.where(s, key)}`,
      Object.values(key),
    );
    await this.persist(s);
  }
  async insertRow(id: string, o: DbObject, values: Record<string, unknown>) {
    const s = await this.writable(id, o, values);
    await this.insert(s, o, values);
    await this.persist(s);
  }
  private async insert(
    s: Session,
    o: DbObject,
    values: Record<string, unknown>,
  ) {
    await this.sql(
      s,
      `INSERT INTO ${this.tableName(s, o)} (${Object.keys(values)
        .map((c) => this.quote(s, c))
        .join(",")}) VALUES (${Object.keys(values)
        .map((_, i) => this.bind(s, i + 1))
        .join(",")})`,
      Object.values(values),
    );
  }
  async importRows(id: string, o: DbObject, rows: Record<string, unknown>[]) {
    if (!rows.length || rows.length > 10000)
      throw new Error("请选择包含 1–10,000 行的 CSV 文件");
    const s = await this.writable(id, o, rows[0]);
    for (const row of rows) await this.writable(id, o, row);
    await this.sql(s, "BEGIN");
    try {
      for (const row of rows) await this.insert(s, o, row);
      await this.sql(s, "COMMIT");
    } catch (error) {
      await this.sql(s, "ROLLBACK");
      throw error;
    }
    await this.persist(s);
    return { imported: rows.length };
  }
  private relational(id: string) {
    const s = this.get(id);
    if (!["mysql", "postgres", "sqlite"].includes(s.config.engine))
      throw new Error("结构比对与数据同步首版支持 MySQL、PostgreSQL、SQLite");
    return s;
  }
  private mappedType(column: Column, source: Session, target: Session) {
    if (source.config.engine === target.config.engine)
      return column.type || "TEXT";
    const family = typeFamily(column.type);
    const types =
      target.config.engine === "mysql"
        ? {
            integer: "BIGINT",
            numeric: "DECIMAL(20,6)",
            boolean: "BOOLEAN",
            datetime: "DATETIME",
            binary: "LONGBLOB",
            json: "JSON",
            text: "TEXT",
          }
        : target.config.engine === "postgres"
          ? {
              integer: "BIGINT",
              numeric: "NUMERIC",
              boolean: "BOOLEAN",
              datetime: "TIMESTAMP",
              binary: "BYTEA",
              json: "JSONB",
              text: "TEXT",
            }
          : {
              integer: "INTEGER",
              numeric: "REAL",
              boolean: "INTEGER",
              datetime: "TEXT",
              binary: "BLOB",
              json: "TEXT",
              text: "TEXT",
            };
    return types[family as keyof typeof types];
  }
  async compareSchemas(
    sourceId: string,
    targetId: string,
    sourceObject: DbObject,
    targetObject: DbObject,
  ): Promise<SchemaComparison> {
    const sourceSession = this.relational(sourceId),
      targetSession = this.relational(targetId);
    const source = await this.schema(sourceId, sourceObject),
      target = await this.schema(targetId, targetObject);
    if (!source.columns.length) throw new Error("源表不存在或没有读取权限");
    const differences = schemaDifferences(source, target);
    const notes: string[] = [];
    const statements: string[] = [];
    const targetName = this.tableName(targetSession, targetObject);
    const definition = (c: Column) => {
      let result = `${this.quote(targetSession, c.name)} ${this.mappedType(c, sourceSession, targetSession)}${c.nullable ? "" : " NOT NULL"}`;
      if (c.defaultValue != null) {
        const value = String(c.defaultValue);
        if (
          sourceSession.config.engine === targetSession.config.engine &&
          /^(?:-?\d+(?:\.\d+)?|'(?:[^']|'')*'|CURRENT_TIMESTAMP(?:\(\))?|NULL|true|false)$/i.test(
            value,
          )
        )
          result += " DEFAULT " + value;
        else notes.push(`${c.name} 的默认表达式未自动迁移，需要人工核对。`);
      }
      return result;
    };
    if (!target.columns.length) {
      const defs = source.columns.map(definition);
      const pk = source.columns.filter((c) => c.primaryKey);
      if (pk.length)
        defs.push(
          `PRIMARY KEY (${pk.map((c) => this.quote(targetSession, c.name)).join(", ")})`,
        );
      statements.push(
        `CREATE TABLE ${targetName} (\n  ${defs.join(",\n  ")}\n);`,
      );
      notes.push(
        "新建表脚本未自动复制自增/identity、外键和索引，需要按目标引擎检查。",
      );
    } else
      for (const difference of differences) {
        const column = source.columns.find((c) => c.name === difference.field);
        if (difference.kind === "missing" && column && !column.primaryKey) {
          statements.push(
            `ALTER TABLE ${targetName} ADD COLUMN ${definition(column)};`,
          );
          if (!column.nullable && column.defaultValue == null)
            notes.push(
              `${column.name} 为非空字段；目标表已有数据时应先填充再设置 NOT NULL。`,
            );
        } else
          notes.push(
            `${difference.field}：${difference.detail}，未生成自动修改或删除语句。`,
          );
      }
    if (sourceSession.config.engine !== targetSession.config.engine)
      notes.unshift(
        "跨引擎类型映射是初步脚本，请检查精度、长度、时区与默认值。",
      );
    return {
      source,
      target,
      differences,
      sql: statements.join("\n\n") || "-- 没有可安全自动生成的结构变更语句。",
      notes: [...new Set(notes)],
    };
  }
  private async snapshot(id: string, o: DbObject) {
    const s = this.relational(id);
    if (o.type !== "table") throw new Error("数据同步只支持数据表");
    if (s.sqlite && s.config.filePath) {
      const current = await fs
        .readFile(s.config.filePath)
        .catch(() => undefined);
      if (
        (current
          ? createHash("sha256").update(current).digest("hex")
          : undefined) !== s.sqliteHash
      )
        throw new Error("SQLite 文件已被其他进程修改，请断开后重新连接。");
    }
    const schema = await this.schema(id, o);
    const result = await this.sql(
      s,
      `SELECT * FROM ${this.tableName(s, o)} LIMIT 10001`,
      [],
      10001,
    );
    if (result.rows.length > 10000 || result.truncated)
      throw new Error(
        "首版单表比对上限为 10,000 行，请缩小数据范围或等待流式同步版本。",
      );
    if (stable(result.rows).length > 8 * 1024 * 1024)
      throw new Error("首版单表比对数据上限为 8 MB");
    return {
      schema,
      rows: result.rows,
      hash: fingerprint(result.rows, schema),
    };
  }
  async compareData(
    sourceId: string,
    targetId: string,
    sourceObject: DbObject,
    targetObject: DbObject,
  ): Promise<SyncPlan> {
    const entry = await this.prepareSync(
      sourceId,
      targetId,
      sourceObject,
      targetObject,
    );
    for (const [id, cached] of this.syncPlans)
      if (new Date(cached.plan.expiresAt).getTime() < Date.now())
        this.syncPlans.delete(id);
    if (this.syncPlans.size >= 10)
      this.syncPlans.delete(this.syncPlans.keys().next().value!);
    this.syncPlans.set(entry.plan.id, entry);
    return entry.plan;
  }
  private async prepareSync(
    sourceId: string,
    targetId: string,
    sourceObject: DbObject,
    targetObject: DbObject,
  ): Promise<SyncEntry> {
    const source = this.relational(sourceId),
      target = this.relational(targetId);
    if (
      ((sourceId === targetId &&
        (source.config.engine !== "mysql" ||
          (sourceObject.schema || source.config.database) ===
            (targetObject.schema || target.config.database))) ||
        (source.config.engine === target.config.engine &&
          ["mysql", "postgres"].includes(source.config.engine) &&
          source.config.host === target.config.host &&
          source.config.port === target.config.port &&
          (source.config.engine === "mysql"
            ? sourceObject.schema || source.config.database
            : source.config.database) ===
            (target.config.engine === "mysql"
              ? targetObject.schema || target.config.database
              : target.config.database))) &&
      sourceObject.name === targetObject.name &&
      (source.config.engine === "mysql" ||
        (sourceObject.schema || "public") === (targetObject.schema || "public"))
    )
      throw new Error("源表和目标表不能相同");
    if (source.config.engine !== target.config.engine)
      throw new Error("首版数据同步仅支持同类型数据库，跨引擎数据同步尚未启用");
    if (
      source.sqlite &&
      source.config.filePath &&
      target.config.filePath &&
      path.resolve(source.config.filePath) ===
        path.resolve(target.config.filePath)
    )
      throw new Error("不能通过两个连接同步同一个 SQLite 文件");
    if (target.config.engine === "mysql") {
      const row = (
        await this.sql(
          target,
          "SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
          [targetObject.schema || target.config.database, targetObject.name],
        )
      ).rows[0];
      if (row?.engine !== "InnoDB")
        throw new Error("为确保事务回滚，MySQL 同步目标必须使用 InnoDB 引擎");
    }
    const from = await this.snapshot(sourceId, sourceObject),
      to = await this.snapshot(targetId, targetObject);
    const columns = from.schema.columns;
    const primaryKeys = columns.filter((c) => c.primaryKey).map((c) => c.name);
    if (
      !primaryKeys.length ||
      stable(primaryKeys) !==
        stable(to.schema.columns.filter((c) => c.primaryKey).map((c) => c.name))
    )
      throw new Error("数据同步需要源表和目标表拥有相同的完整主键");
    if (
      columns.length !== to.schema.columns.length ||
      columns.some(
        (c) =>
          !to.schema.columns.some(
            (t) =>
              t.name === c.name &&
              t.type.toLowerCase() === c.type.toLowerCase(),
          ),
      )
    )
      throw new Error("源表和目标表字段名称/类型不一致，请先完成结构比对");
    const { changes, unchanged } = compareRows(
      from.rows,
      to.rows,
      primaryKeys,
      columns,
    );
    const plan: SyncPlan = {
      id: randomUUID(),
      sourceId,
      targetId,
      sourceObject,
      targetObject,
      changes,
      unchanged,
      sourceCount: from.rows.length,
      targetCount: to.rows.length,
      primaryKeys,
      columns: columns.map((c) => c.name),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    return {
      plan,
      sourceHash: from.hash,
      targetHash: to.hash,
    };
  }
  private scopedObject(scope: DatabaseScope, object: DbObject): DbObject {
    if (object.type !== "table") throw new Error("数据同步只支持数据表");
    const engine = this.relational(scope.connectionId).config.engine;
    return {
      ...object,
      schema:
        engine === "mysql"
          ? scope.database
          : engine === "postgres"
            ? object.schema || "public"
            : undefined,
    };
  }
  private scopedPairs(
    source: DatabaseScope,
    target: DatabaseScope,
    tables: TablePair[],
  ) {
    if (!tables.length || tables.length > 500)
      throw new Error("请选择 1 至 500 张数据表");
    const pairs = tables.map((pair) => ({
      source: this.scopedObject(source, pair.source),
      target: this.scopedObject(target, pair.target),
    }));
    const key = (object: DbObject) =>
      JSON.stringify([object.schema, object.name]);
    if (
      new Set(pairs.map((pair) => key(pair.source))).size !== pairs.length ||
      new Set(pairs.map((pair) => key(pair.target))).size !== pairs.length
    )
      throw new Error("同一张表不能重复选择或映射");
    return pairs;
  }
  async compareDatabaseSchemas(
    source: DatabaseScope,
    target: DatabaseScope,
    tables: TablePair[],
  ): Promise<DatabaseSchemaComparison> {
    const pairs = this.scopedPairs(source, target, tables);
    return this.inDatabase(source, (sourceId) =>
      this.inDatabase(target, async (targetId) => {
        const results: DatabaseSchemaComparison["tables"] = [];
        for (const pair of pairs)
          results.push({
            ...(await this.compareSchemas(
              sourceId,
              targetId,
              pair.source,
              pair.target,
            )),
            sourceObject: pair.source,
            targetObject: pair.target,
          });
        return {
          tables: results,
          sql: results
            .map((result) => result.sql)
            .filter((sql) => !sql.startsWith("--"))
            .join("\n\n"),
        };
      }),
    );
  }
  async compareDatabaseData(
    source: DatabaseScope,
    target: DatabaseScope,
    tables: TablePair[],
  ): Promise<DatabaseSyncPlan> {
    const pairs = this.scopedPairs(source, target, tables);
    const entries = await this.inDatabase(source, (sourceId) =>
      this.inDatabase(target, async (targetId) => {
        const results: SyncEntry[] = [];
        for (const pair of pairs) {
          try {
            results.push(
              await this.prepareSync(
                sourceId,
                targetId,
                pair.source,
                pair.target,
              ),
            );
          } catch (error) {
            throw new Error(
              `${pair.source.name} → ${pair.target.name}: ${(error as Error).message}`,
            );
          }
        }
        return results;
      }),
    );
    // Keep connection identities stable after closing any temporary sessions.
    for (const entry of entries) {
      entry.plan.sourceId = source.connectionId;
      entry.plan.targetId = target.connectionId;
    }
    const plan: DatabaseSyncPlan = {
      id: randomUUID(),
      source,
      target,
      tables: entries.map((entry) => entry.plan),
      expiresAt: entries[0].plan.expiresAt,
    };
    for (const [id, cached] of this.databaseSyncPlans)
      if (new Date(cached.plan.expiresAt).getTime() < Date.now())
        this.databaseSyncPlans.delete(id);
    if (this.databaseSyncPlans.size >= 10)
      this.databaseSyncPlans.delete(
        this.databaseSyncPlans.keys().next().value!,
      );
    this.databaseSyncPlans.set(plan.id, { plan, entries });
    return plan;
  }
  async applyDatabaseSync(planId: string, deleteExtra: boolean) {
    const cached = this.databaseSyncPlans.get(planId);
    if (!cached || new Date(cached.plan.expiresAt).getTime() < Date.now())
      throw new Error("同步方案已过期，请重新比对");
    const result = await this.inDatabase(cached.plan.source, (sourceId) =>
      this.inDatabase(cached.plan.target, (targetId) =>
        this.applySyncEntries(cached.entries, deleteExtra, sourceId, targetId),
      ),
    );
    this.databaseSyncPlans.delete(planId);
    return result;
  }
  async applySync(planId: string, deleteExtra: boolean) {
    const entry = this.syncPlans.get(planId);
    if (!entry || new Date(entry.plan.expiresAt).getTime() < Date.now())
      throw new Error("同步方案已过期，请重新比对");
    const result = await this.applySyncEntries(
      [entry],
      deleteExtra,
      entry.plan.sourceId,
      entry.plan.targetId,
    );
    this.syncPlans.delete(planId);
    return result;
  }
  private async applySyncEntries(
    entries: SyncEntry[],
    deleteExtra: boolean,
    sourceId: string,
    targetId: string,
  ) {
    this.relational(sourceId);
    const target = this.relational(targetId);
    const counts = { inserted: 0, updated: 0, deleted: 0 };
    let targetTransaction = false;
    try {
      if (target.config.engine === "postgres")
        await this.sql(
          target,
          "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
        );
      else if (target.config.engine === "mysql") {
        await this.sql(target, "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        await this.sql(target, "START TRANSACTION");
      } else await this.sql(target, "BEGIN");
      targetTransaction = true;
      const schemas = new Map<SyncEntry, TableInfo>();
      for (const entry of entries) {
        const { plan } = entry;
        const freshSource = await this.snapshot(sourceId, plan.sourceObject),
          freshTarget = await this.snapshot(targetId, plan.targetObject);
        if (
          freshSource.hash !== entry.sourceHash ||
          freshTarget.hash !== entry.targetHash
        )
          throw new Error(
            "比对后源表或目标表发生了变化。已取消同步，请重新比对。",
          );
        schemas.set(entry, freshTarget.schema);
      }
      // Parents are written first; child rows are removed first.
      const ordered: SyncEntry[] = [],
        visiting = new Set<SyncEntry>();
      const visit = (entry: SyncEntry) => {
        if (ordered.includes(entry) || visiting.has(entry)) return;
        visiting.add(entry);
        for (const fk of schemas.get(entry)!.foreignKeys) {
          const parent = entries.find(
            (candidate) =>
              candidate !== entry &&
              candidate.plan.targetObject.name === fk.table &&
              candidate.plan.targetObject.schema ===
                entry.plan.targetObject.schema,
          );
          if (parent) visit(parent);
        }
        visiting.delete(entry);
        ordered.push(entry);
      };
      entries.forEach(visit);
      for (const phase of ["write", "delete"] as const) {
        for (const entry of phase === "write"
          ? ordered
          : [...ordered].reverse()) {
          const { plan } = entry;
          for (const change of plan.changes) {
            if ((change.kind === "delete") !== (phase === "delete")) continue;
            if (change.kind === "insert") {
              const values = change.source!;
              await this.sql(
                target,
                `INSERT INTO ${this.tableName(target, plan.targetObject)} (${Object.keys(
                  values,
                )
                  .map((c) => this.quote(target, c))
                  .join(
                    ",",
                  )})${target.config.engine === "postgres" ? " OVERRIDING SYSTEM VALUE" : ""} VALUES (${Object.keys(
                  values,
                )
                  .map((_, i) => this.bind(target, i + 1))
                  .join(",")})`,
                Object.values(values),
              );
              counts.inserted++;
            }
            if (change.kind === "update") {
              const values = Object.fromEntries(
                change.fields.map((c) => [c, change.source![c]]),
              );
              await this.sql(
                target,
                `UPDATE ${this.tableName(target, plan.targetObject)} SET ${Object.keys(
                  values,
                )
                  .map(
                    (c, i) =>
                      `${this.quote(target, c)}=${this.bind(target, i + 1)}`,
                  )
                  .join(
                    ",",
                  )} WHERE ${this.where(target, change.key, Object.keys(values).length)}`,
                [...Object.values(values), ...Object.values(change.key)],
              );
              counts.updated++;
            }
            if (change.kind === "delete" && deleteExtra) {
              await this.sql(
                target,
                `DELETE FROM ${this.tableName(target, plan.targetObject)} WHERE ${this.where(target, change.key)}`,
                Object.values(change.key),
              );
              counts.deleted++;
            }
          }
        }
      }
      for (const entry of entries) {
        const { plan } = entry;
        if (
          target.config.engine === "postgres" &&
          plan.changes.some((change) => change.kind === "insert")
        ) {
          for (const column of schemas
            .get(entry)!
            .columns.filter((c) => c.primaryKey)) {
            const sequence = (
              await this.sql(
                target,
                "SELECT pg_get_serial_sequence($1,$2) AS sequence",
                [this.tableName(target, plan.targetObject), column.name],
              )
            ).rows[0]?.sequence;
            if (sequence) {
              const maximum = (
                await this.sql(
                  target,
                  `SELECT MAX(${this.quote(target, column.name)}) AS maximum FROM ${this.tableName(target, plan.targetObject)}`,
                )
              ).rows[0]?.maximum;
              if (maximum != null) {
                await this.sql(
                  target,
                  `SELECT setval($1::regclass, GREATEST($2::bigint,COALESCE((SELECT p.last_value FROM pg_sequences p JOIN pg_namespace n ON n.nspname=p.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=p.sequencename WHERE c.oid=$1::regclass),1)),true)`,
                  [sequence, maximum],
                );
              }
            }
          }
        }
      }
      await this.sql(target, "COMMIT");
      targetTransaction = false;
      await this.persist(target);
      return counts;
    } catch (error) {
      if (targetTransaction) await this.sql(target, "ROLLBACK").catch(() => {});
      throw error;
    }
  }
  async backup(id: string) {
    const s = this.get(id);
    if (!s.sqlite)
      throw new Error(
        "首版文件备份仅支持 SQLite；其他数据库可导出结果为 CSV / JSON",
      );
    return {
      filename: `${s.config.database || "database"}-${new Date().toISOString().slice(0, 10)}.db`,
      data: Buffer.from(s.sqlite.export()).toString("base64"),
    };
  }
  async exportSql(id: string, selected?: DbObject) {
    const s = this.relational(id);
    const objects = (await this.objects(id)).filter(
      (o) =>
        !selected || (o.name === selected.name && o.schema === selected.schema),
    );
    const tables = objects.filter((o) => o.type === "table");
    const views = objects.filter((o) => o.type === "view");
    const lines = [
      `-- SQLStudio SQL export\n-- Database: ${s.config.database.replace(/[\r\n]/g, " ")}\n-- Engine: ${s.config.engine}\n-- Generated: ${new Date().toISOString()}\n`,
    ];
    let rows = 0;
    if (selected && !objects.length) throw new Error("对象不存在或无读取权限");
    if (s.sqlite) lines.push("PRAGMA foreign_keys=OFF;");
    if (s.config.engine === "postgres")
      lines.push("SET standard_conforming_strings=on;");
    if (s.config.engine === "mysql")
      lines.push(
        "SET @SQLSTUDIO_OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS;\nSET FOREIGN_KEY_CHECKS=0;",
      );
    const extra: string[] = [];
    for (const o of tables) {
      if (s.sqlite) {
        lines.push(
          String(
            (
              await this.sql(
                s,
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                [o.name],
              )
            ).rows[0].sql,
          ) + ";",
        );
        extra.push(
          ...(
            await this.sql(
              s,
              "SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL",
              [o.name],
            )
          ).rows.map((r) => String(r.sql) + ";"),
        );
      } else if (s.config.engine === "mysql") {
        const ddl = (
          await this.sql(s, `SHOW CREATE TABLE ${this.tableName(s, o)}`)
        ).rows[0];
        lines.push(String(ddl["Create Table"]) + ";");
      } else {
        const info = await this.schema(id, o);
        if (
          o.schema &&
          o.schema !== "public" &&
          !lines.includes(
            `CREATE SCHEMA IF NOT EXISTS ${this.quote(s, o.schema)};`,
          )
        )
          lines.push(`CREATE SCHEMA IF NOT EXISTS ${this.quote(s, o.schema)};`);
        const definitions: string[] = [];
        for (const column of info.columns) {
          if (column.generationExpression)
            throw new Error(
              "PostgreSQL 生成列导出请使用 pg_dump；首版 SQL 导出暂不包含生成列表。",
            );
          const sequence =
            column.identity ||
            !String(column.defaultValue ?? "").startsWith("nextval(")
              ? null
              : (
                  await this.sql(
                    s,
                    "SELECT pg_get_serial_sequence($1,$2) AS sequence",
                    [this.tableName(s, o), column.name],
                  )
                ).rows[0]?.sequence;
          if (sequence) {
            lines.push(`CREATE SEQUENCE ${sequence};`);
            extra.push(
              `ALTER SEQUENCE ${sequence} OWNED BY ${this.tableName(s, o)}.${this.quote(s, column.name)};`,
            );
            extra.push(
              `SELECT setval(${sqlLiteral(sequence, "postgres")},COALESCE(MAX(${this.quote(s, column.name)}),1),MAX(${this.quote(s, column.name)}) IS NOT NULL) FROM ${this.tableName(s, o)};`,
            );
          }
          if (column.identity) {
            const identitySequence = (
              await this.sql(
                s,
                "SELECT pg_get_serial_sequence($1,$2) AS sequence",
                [this.tableName(s, o), column.name],
              )
            ).rows[0]?.sequence;
            if (identitySequence)
              extra.push(
                `SELECT setval(pg_get_serial_sequence(${sqlLiteral(this.tableName(s, o), "postgres")},${sqlLiteral(column.name, "postgres")}),COALESCE(MAX(${this.quote(s, column.name)}),1),MAX(${this.quote(s, column.name)}) IS NOT NULL) FROM ${this.tableName(s, o)};`,
              );
          }
          definitions.push(
            `${this.quote(s, column.name)} ${column.type}${column.identity ? " GENERATED " + column.identity + " AS IDENTITY" : ""}${column.nullable ? "" : " NOT NULL"}${column.defaultValue != null ? " DEFAULT " + String(column.defaultValue) : ""}`,
          );
        }
        const constraints = (
          await this.sql(
            s,
            "SELECT conname AS name,contype AS type,pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname",
            [this.tableName(s, o)],
          )
        ).rows;
        for (const constraint of constraints) {
          if (constraint.type === "f")
            extra.push(
              `ALTER TABLE ${this.tableName(s, o)} ADD CONSTRAINT ${this.quote(s, String(constraint.name))} ${constraint.definition};`,
            );
          else
            definitions.push(
              `CONSTRAINT ${this.quote(s, String(constraint.name))} ${constraint.definition}`,
            );
        }
        lines.push(
          `CREATE TABLE ${this.tableName(s, o)} (\n  ${definitions.join(",\n  ")}\n);`,
        );
        for (const index of info.indexes)
          if (!constraints.some((c) => c.name === index.name))
            extra.push(index.columns + ";");
      }
    }
    for (const o of tables) {
      // PostgreSQL's text output preserves arrays, JSON null, numeric precision
      // and timestamp microseconds that JavaScript type parsers can otherwise lose.
      const selection =
        s.config.engine === "postgres"
          ? (await this.schema(id, o)).columns
              .map(
                (column) =>
                  `CAST(${this.quote(s, column.name)} AS text) AS ${this.quote(s, column.name)}`,
              )
              .join(",")
          : "*";
      const result = await this.sql(
        s,
        `SELECT ${selection} FROM ${this.tableName(s, o)} LIMIT 10001`,
        [],
        10001,
      );
      if (result.rows.length > 10000)
        throw new Error(`首版 SQL 导出每表上限 10,000 行：${o.name} 超出限制`);
      for (const row of result.rows) {
        lines.push(
          `INSERT INTO ${this.tableName(s, o)} (${result.columns.map((c) => this.quote(s, c)).join(",")})${s.config.engine === "postgres" ? " OVERRIDING SYSTEM VALUE" : ""} VALUES (${result.columns.map((c) => sqlLiteral(row[c], s.config.engine)).join(",")});`,
        );
        rows++;
      }
    }
    lines.push(...extra);
    for (const o of views) {
      if (s.sqlite)
        lines.push(
          String(
            (
              await this.sql(
                s,
                "SELECT sql FROM sqlite_master WHERE type='view' AND name=?",
                [o.name],
              )
            ).rows[0].sql,
          ) + ";",
        );
      else if (s.config.engine === "mysql")
        lines.push(
          String(
            (await this.sql(s, `SHOW CREATE VIEW ${this.tableName(s, o)}`))
              .rows[0]["Create View"],
          ) + ";",
        );
      else {
        const definition = (
          await this.sql(
            s,
            "SELECT pg_get_viewdef(($1)::regclass,true) AS definition",
            [this.tableName(s, o)],
          )
        ).rows[0].definition;
        lines.push(
          `CREATE VIEW ${this.tableName(s, o)} AS ${String(definition).replace(/;\s*$/, "")};`,
        );
      }
    }
    if (s.sqlite) lines.push("PRAGMA foreign_keys=ON;");
    if (s.config.engine === "mysql")
      lines.push("SET FOREIGN_KEY_CHECKS=@SQLSTUDIO_OLD_FOREIGN_KEY_CHECKS;");
    const script = lines.join("\n\n") + "\n";
    if (Buffer.byteLength(script) > 20 * 1024 * 1024)
      throw new Error("首版 SQL 导出文件上限为 20 MB");
    return {
      filename: `${selected?.name ?? s.config.database ?? "database"}-${new Date().toISOString().slice(0, 10)}.sql`,
      sql: script,
      tables: tables.length,
      rows,
    };
  }
  async importSql(id: string, script: string) {
    const s = this.relational(id);
    let escape = false;
    let previousForeignKeys: number | undefined;
    if (s.config.engine === "mysql") {
      previousForeignKeys = Number(
        (await this.sql(s, "SELECT @@FOREIGN_KEY_CHECKS AS enabled")).rows[0]
          .enabled,
      );
      const mode = String(
        (await this.sql(s, "SELECT @@sql_mode AS mode")).rows[0].mode,
      );
      escape = !mode.includes("NO_BACKSLASH_ESCAPES");
    }
    let statements = splitSql(script.replace(/^\uFEFF/, ""), escape);
    if (!statements.length) throw new Error("SQL 文件没有可执行语句");
    if (statements.length > 50000)
      throw new Error("首版 SQL 导入最多 50,000 条语句");
    if (
      statements.some((text) =>
        /^\s*(DELIMITER|BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|CREATE\s+DATABASE|USE|ATTACH|DETACH)\b/i.test(
          stripComments(text),
        ),
      )
    )
      throw new Error(
        "SQL 文件包含不支持的事务 / 数据库切换 / DELIMITER 指令，请移除后重试",
      );
    const transactional = s.config.engine !== "mysql";
    if (s.sqlite) {
      s.sqlite.run("PRAGMA foreign_keys=OFF");
      statements = statements.filter(
        (text) => !/^PRAGMA\s+foreign_keys\b/i.test(stripComments(text)),
      );
    }
    let transaction = false;
    try {
      await this.sql(s, "BEGIN");
      transaction = true;
      if (s.sqlite) await this.sql(s, statements.join(";\n") + ";");
      else for (const statement of statements) await this.sql(s, statement);
      if (
        s.sqlite &&
        (await this.sql(s, "PRAGMA foreign_key_check")).rows.length
      )
        throw new Error("导入数据存在外键约束冲突，已回滚");
      await this.sql(s, "COMMIT");
      transaction = false;
      await this.persist(s);
      return { statements: statements.length, transactional };
    } catch (error) {
      if (transaction) await this.sql(s, "ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (s.sqlite) s.sqlite.run("PRAGMA foreign_keys=ON");
      if (s.config.engine === "mysql")
        await this.sql(
          s,
          `SET FOREIGN_KEY_CHECKS=${previousForeignKeys === 0 ? 0 : 1}`,
        ).catch(() => {});
    }
  }
  async renameObject(id: string, o: DbObject, newName: string) {
    const s = this.get(id);
    if (!newName.trim()) throw new Error("请填写新名称");
    if (s.config.engine === "mongodb") {
      if (o.type !== "collection") throw new Error("请选择集合");
      await s.client
        .db(s.config.database || undefined)
        .collection(o.name)
        .rename(newName);
      return;
    }
    if (s.config.engine === "redis") {
      await s.client.renameNX(o.name, newName).then((renamed: boolean) => {
        if (!renamed) throw new Error("目标键已存在");
      });
      return;
    }
    if (o.type !== "table") throw new Error("首版重命名仅支持表、集合和键");
    await this.sql(
      s,
      `ALTER TABLE ${this.tableName(s, o)} RENAME TO ${s.config.engine === "mysql" ? this.tableName(s, { ...o, name: newName }) : this.quote(s, newName)}`,
    );
    await this.persist(s);
  }
  async dropObject(id: string, o: DbObject) {
    const s = this.get(id);
    if (s.config.engine === "mongodb") {
      if (o.type !== "collection") throw new Error("请选择集合");
      await s.client
        .db(s.config.database || undefined)
        .collection(o.name)
        .drop();
      return;
    }
    if (s.config.engine === "redis") {
      await s.client.del(o.name);
      return;
    }
    if (!["table", "view"].includes(o.type))
      throw new Error("对象类型不支持删除");
    await this.sql(
      s,
      `DROP ${o.type === "view" ? "VIEW" : "TABLE"} ${this.tableName(s, o)}`,
    );
    await this.persist(s);
  }
}
