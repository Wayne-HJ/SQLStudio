import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { DatabaseService } from "../server/service.js";
import { createDispatcher } from "../server/rpc.js";
import type { Connection, DbObject } from "../shared/types.js";

const connection: Connection = {
  id: "mysql-server",
  name: "MySQL server",
  engine: "mysql",
  host: "localhost",
  port: 3306,
  database: "",
  username: "test",
  ssl: false,
  color: "#5b7cfa",
  environment: "local",
};

async function fixture(
  run: (
    service: DatabaseService,
    calls: { sql: string; params: unknown[] }[],
  ) => Promise<void>,
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sqlstudio-mysql-"),
  );
  const calls: { sql: string; params: unknown[] }[] = [];
  let database = "";
  let names = ["commerce", "empty", "odd`name", "information_schema"];
  const rows = (values: Record<string, unknown>[]) => [
    values,
    Object.keys(values[0] ?? {}).map((name) => ({ name })),
  ];
  const client = {
    on() {},
    async query(input: string | { sql: string }, params: unknown[] = []) {
      const sql = typeof input === "string" ? input : input.sql;
      calls.push({ sql, params });
      if (sql === "SELECT VERSION() AS version")
        return rows([{ version: "8.4" }]);
      if (sql === "SHOW DATABASES")
        return rows(names.map((Database) => ({ Database })));
      if (sql === "SELECT DATABASE() AS name")
        return rows([{ name: database || null }]);
      if (sql.startsWith("USE ")) {
        const next = sql.slice(5, -1).replaceAll("``", "`");
        if (next === "denied")
          throw new Error("Access denied for database denied");
        database = next;
        return [{ affectedRows: 0 }, []];
      }
      if (sql.startsWith("DROP DATABASE ")) {
        const dropped = sql.slice(15, -1).replaceAll("``", "`");
        names = names.filter((name) => name !== dropped);
        if (database === dropped) database = "";
        return [{ affectedRows: 0 }, []];
      }
      if (sql.startsWith("SELECT ENGINE AS engine"))
        return rows([{ engine: "InnoDB" }]);
      if (sql.includes("FROM information_schema.TABLES"))
        return rows(
          params[0] && params[0] !== "empty"
            ? [
                { name: "customers", type: "table" },
                { name: "summary", type: "view" },
              ]
            : [],
        );
      if (sql.includes("FROM information_schema.COLUMNS"))
        return rows([
          {
            name: "id",
            type: "int",
            nullable: "NO",
            pk: "PRI",
            defaultValue: null,
          },
        ]);
      if (
        sql.includes("FROM information_schema.KEY_COLUMN_USAGE") ||
        sql.includes("FROM information_schema.STATISTICS")
      )
        return rows([]);
      if (sql.startsWith("SELECT COUNT(*)")) return rows([{ total: 1 }]);
      if (sql.startsWith("SELECT *")) return rows([{ id: 1 }]);
      return [{ affectedRows: 1 }, []];
    },
    async end() {},
  };
  const factory = mock.method(
    mysql,
    "createConnection",
    async (config: { database?: string }) => {
      database = config.database ?? "";
      return client;
    },
  );
  const service = new DatabaseService(directory);
  try {
    await service.saveConnection(connection);
    await service.connect(connection);
    await run(service, calls);
  } finally {
    await service.shutdown();
    factory.mock.restore();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("blank MySQL database discovers accessible databases through RPC and selects a database", () =>
  fixture(async (service) => {
    const dispatch = createDispatcher(service);
    assert.deepEqual(await dispatch("databases", [connection.id]), {
      names: ["commerce", "empty", "odd`name", "information_schema"],
      selected: "",
    });
    assert.deepEqual(await service.objects(connection.id), []);
    await dispatch("selectDatabase", [connection.id, "commerce"]);
    assert.deepEqual(await dispatch("databases", [connection.id]), {
      names: ["commerce", "empty", "odd`name", "information_schema"],
      selected: "commerce",
    });
    assert.deepEqual(
      (await service.objects(connection.id)).map(({ name, type, schema }) => ({
        name,
        type,
        schema,
      })),
      [
        { name: "customers", type: "table", schema: "commerce" },
        { name: "summary", type: "view", schema: "commerce" },
      ],
    );
    assert.equal(
      (await service.connections()).find((c) => c.id === connection.id)
        ?.database,
      "",
    );
    await service.disconnect(connection.id);
    await service.connect(connection);
    assert.equal(
      ((await dispatch("databases", [connection.id])) as { selected: string })
        .selected,
      "",
    );
  }));

test("database selection escapes identifiers and leaves the current database intact when access is denied", () =>
  fixture(async (service, calls) => {
    const dispatch = createDispatcher(service);
    await dispatch("selectDatabase", [connection.id, "odd`name"]);
    assert.ok(calls.some((call) => call.sql === "USE `odd``name`"));
    await assert.rejects(
      dispatch("selectDatabase", [connection.id, "denied"]),
      /Access denied/,
    );
    assert.equal(
      ((await dispatch("databases", [connection.id])) as { selected: string })
        .selected,
      "odd`name",
    );
    await dispatch("selectDatabase", [connection.id, "empty"]);
    assert.deepEqual(await service.objects(connection.id), []);
    assert.equal(
      ((await dispatch("databases", [connection.id])) as { selected: string })
        .selected,
      "empty",
    );
  }));

test("MySQL table reads, metadata and writes stay qualified to the original database after switching", () =>
  fixture(async (service, calls) => {
    const dispatch = createDispatcher(service);
    await dispatch("selectDatabase", [connection.id, "commerce"]);
    const object: DbObject = {
      name: "customers",
      type: "table",
      schema: "commerce",
    };
    await dispatch("selectDatabase", [connection.id, "odd`name"]);
    calls.length = 0;
    await service.table(connection.id, object);
    await service.updateRow(connection.id, object, { id: 1 }, { id: 2 });
    await service.renameObject(connection.id, object, "renamed");
    assert.ok(
      calls
        .filter((call) => call.sql.includes("information_schema."))
        .every((call) => call.params[0] === "commerce"),
    );
    assert.ok(
      calls.some((call) =>
        call.sql.startsWith("SELECT * FROM `commerce`.`customers`"),
      ),
    );
    assert.ok(
      calls.some((call) =>
        call.sql.startsWith("UPDATE `commerce`.`customers`"),
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.sql ===
          "ALTER TABLE `commerce`.`customers` RENAME TO `commerce`.`renamed`",
      ),
    );
  }));

test("database-scoped batch comparisons use two databases on one connection without changing selection", () =>
  fixture(async (service, calls) => {
    await service.selectDatabase(connection.id, "commerce");
    const source = { connectionId: connection.id, database: "commerce" },
      target = { connectionId: connection.id, database: "odd`name" };
    const objects = await service.databaseObjects(target);
    assert.equal(objects[0].schema, "odd`name");
    const tables = [
      {
        source: { name: "customers", type: "table" as const },
        target: { name: "customers", type: "table" as const },
      },
    ];
    calls.length = 0;
    const plan = await service.compareDatabaseData(source, target, tables);
    await service.selectDatabase(connection.id, "empty");
    calls.length = 0;
    assert.deepEqual(await service.applyDatabaseSync(plan.id, false), {
      inserted: 0,
      updated: 0,
      deleted: 0,
    });
    assert.ok(
      calls.some((call) =>
        call.sql.startsWith("SELECT * FROM `commerce`.`customers`"),
      ),
    );
    assert.ok(
      calls.some((call) =>
        call.sql.startsWith("SELECT * FROM `odd``name`.`customers`"),
      ),
    );
    assert.equal((await service.databases(connection.id)).selected, "empty");
    await assert.rejects(
      service.compareDatabaseData(source, source, tables),
      /不能相同/,
    );
  }));

test("MySQL database deletion drops the actual escaped database and preserves the connection profile", () =>
  fixture(async (service, calls) => {
    await service.saveConnection({ ...connection, database: "odd`name" });
    await service.connect({ ...connection, database: "odd`name" });
    await createDispatcher(service)("dropDatabase", [
      connection.id,
      "odd`name",
    ]);
    assert.ok(calls.some((call) => call.sql === "DROP DATABASE `odd``name`"));
    const catalog = await service.databases(connection.id);
    assert.equal(catalog.selected, "");
    assert.ok(!catalog.names.includes("odd`name"));
    assert.equal(
      (await service.connections()).find((c) => c.id === connection.id)
        ?.database,
      "",
    );
    await service.disconnect(connection.id);
    await service.connect(connection);
    assert.equal((await service.databases(connection.id)).selected, "");
    await assert.rejects(
      service.dropDatabase(connection.id, "information_schema"),
      /系统数据库/,
    );
  }));
