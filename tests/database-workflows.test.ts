import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService, demoConnection } from "../server/service.js";
import { createDispatcher } from "../server/rpc.js";
import type { Connection, DatabaseScope, TablePair } from "../shared/types.js";

const source: DatabaseScope = { connectionId: "source", database: "source.db" };
const target: DatabaseScope = { connectionId: "target", database: "target.db" };
const pair = (name: string): TablePair => ({
  source: { name, type: "table" },
  target: { name, type: "table" },
});
async function fixture(
  run: (
    service: DatabaseService,
    directory: string,
    configs: Connection[],
  ) => Promise<void>,
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sqlstudio-databases-"),
  );
  const service = new DatabaseService(directory);
  const configs = [source, target].map((scope) => ({
    ...demoConnection,
    id: scope.connectionId,
    name: scope.connectionId,
    database: scope.database,
    filePath: path.join(directory, scope.database),
  }));
  try {
    for (const config of configs) {
      await service.saveConnection(config);
      await service.connect(config);
    }
    await run(service, directory, configs);
  } finally {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
async function tables(service: DatabaseService, count = 2) {
  const pairs = Array.from({ length: count }, (_, index) =>
    pair(`items_${index}`),
  );
  for (const item of pairs) {
    for (const scope of [source, target])
      await service.query(
        scope.connectionId,
        `CREATE TABLE ${item.source.name}(id INTEGER PRIMARY KEY, value TEXT)`,
      );
    await service.query(
      source.connectionId,
      `INSERT INTO ${item.source.name} VALUES(1,'source'),(2,'insert')`,
    );
    await service.query(
      target.connectionId,
      `INSERT INTO ${item.source.name} VALUES(1,'target'),(3,'extra')`,
    );
  }
  return pairs;
}

test("database-scoped schema comparison includes all selected tables and missing targets", () =>
  fixture(async (service) => {
    const dispatch = createDispatcher(service);
    const pairs = await tables(service);
    await service.query(
      "source",
      "CREATE TABLE new_table(id INTEGER PRIMARY KEY, note TEXT)",
    );
    const result = await service.compareDatabaseSchemas(source, target, [
      ...pairs,
      pair("new_table"),
    ]);
    assert.equal(result.tables.length, 3);
    assert.match(result.sql, /CREATE TABLE "new_table"/);
    assert.equal(
      ((await dispatch("databaseObjects", [source])) as unknown[]).length,
      3,
    );
    await assert.rejects(
      service.databaseObjects({ ...source, database: "unrelated.db" }),
      /不支持切换/,
    );
    await assert.rejects(
      service.compareDatabaseData(source, target, []),
      /请选择/,
    );
    await assert.rejects(
      service.compareDatabaseData(source, target, [pairs[0], pairs[0]]),
      /重复/,
    );
  }));

test("a batch of more than ten tables keeps all plans and applies them in one operation", () =>
  fixture(async (service) => {
    const pairs = await tables(service, 12);
    const dispatch = createDispatcher(service);
    const plan = (await dispatch("compareDatabaseData", [
      source,
      target,
      pairs,
    ])) as Awaited<ReturnType<DatabaseService["compareDatabaseData"]>>;
    assert.equal(plan.tables.length, 12);
    const result = await dispatch("applyDatabaseSync", [plan.id, false]);
    assert.deepEqual(result, { inserted: 12, updated: 12, deleted: 0 });
    for (const item of pairs) {
      const result = await service.query(
        "target",
        `SELECT * FROM ${item.target.name} ORDER BY id`,
      );
      assert.deepEqual(result.rows, [
        { id: 1, value: "source" },
        { id: 2, value: "insert" },
        { id: 3, value: "extra" },
      ]);
    }
    await assert.rejects(service.applyDatabaseSync(plan.id, false), /过期/);
  }));

test("a later table constraint failure rolls back changes to every earlier table", () =>
  fixture(async (service) => {
    const pairs = await tables(service, 1);
    await service.query(
      "source",
      "CREATE TABLE failing(id INTEGER PRIMARY KEY,value INTEGER)",
    );
    await service.query(
      "target",
      "CREATE TABLE failing(id INTEGER PRIMARY KEY,value INTEGER CHECK(value>=0))",
    );
    await service.query("source", "INSERT INTO failing VALUES(1,-1)");
    const plan = await service.compareDatabaseData(source, target, [
      ...pairs,
      pair("failing"),
    ]);
    await assert.rejects(service.applyDatabaseSync(plan.id, true), /CHECK/);
    assert.deepEqual(
      (await service.query("target", "SELECT * FROM items_0 ORDER BY id")).rows,
      [
        { id: 1, value: "target" },
        { id: 3, value: "extra" },
      ],
    );
    assert.equal(
      (await service.table("target", pair("failing").target)).total,
      0,
    );
  }));

for (const changed of ["source", "target"])
  test(`a change in a later ${changed} table cancels the whole batch before writing`, () =>
    fixture(async (service) => {
      const pairs = await tables(service);
      const plan = await service.compareDatabaseData(source, target, pairs);
      await service.query(
        changed,
        "UPDATE items_1 SET value='concurrent' WHERE id=1",
      );
      await assert.rejects(
        service.applyDatabaseSync(plan.id, true),
        /发生了变化/,
      );
      assert.equal(
        (await service.query("target", "SELECT value FROM items_0 WHERE id=1"))
          .rows[0].value,
        "target",
      );
      assert.equal(
        (await service.table("target", pair("items_0").target)).total,
        2,
      );
    }));

test("batch synchronization writes parents first and deletes children first regardless of selection order", () =>
  fixture(async (service) => {
    for (const scope of [source, target]) {
      await service.query(
        scope.connectionId,
        "CREATE TABLE parents(id INTEGER PRIMARY KEY)",
      );
      await service.query(
        scope.connectionId,
        "CREATE TABLE children(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parents(id))",
      );
    }
    await service.query("source", "INSERT INTO parents VALUES(1)");
    await service.query("source", "INSERT INTO children VALUES(1,1)");
    await service.query("target", "INSERT INTO parents VALUES(2)");
    await service.query("target", "INSERT INTO children VALUES(2,2)");
    const plan = await service.compareDatabaseData(source, target, [
      pair("children"),
      pair("parents"),
    ]);
    assert.deepEqual(await service.applyDatabaseSync(plan.id, true), {
      inserted: 2,
      updated: 0,
      deleted: 2,
    });
    for (const name of ["children", "parents"])
      assert.deepEqual(
        (await service.query("target", `SELECT * FROM ${name}`)).rows,
        (await service.query("source", `SELECT * FROM ${name}`)).rows,
      );
  }));

test("SQLite database deletion removes the actual file, closes aliases, retains profiles and invalidates plans", () =>
  fixture(async (service, directory, configs) => {
    const pairs = await tables(service);
    const plan = await service.compareDatabaseData(source, target, pairs);
    const alias = { ...configs[1], id: "alias" };
    await service.saveConnection(alias);
    await service.connect(alias);
    await createDispatcher(service)("dropDatabase", ["target", "target.db"]);
    await assert.rejects(fs.stat(path.join(directory, "target.db")), {
      code: "ENOENT",
    });
    const connections = await service.connections();
    for (const id of ["target", "alias"]) {
      assert.equal(connections.find((c) => c.id === id)?.connected, false);
      assert.ok(connections.find((c) => c.id === id));
    }
    await assert.rejects(service.applyDatabaseSync(plan.id, false), /过期/);
    await service.shutdown();
    await assert.rejects(fs.stat(path.join(directory, "target.db")), {
      code: "ENOENT",
    });
  }));

test("database deletion rejects demo aliases, mismatched names and externally modified SQLite files", () =>
  fixture(async (service, directory, configs) => {
    await service.connect(demoConnection);
    await assert.rejects(
      service.dropDatabase("demo", demoConnection.database),
      /示例数据库/,
    );
    await service.connect({
      ...configs[0],
      id: "demo-alias",
      database: "commerce.db",
      filePath: path.join(directory, "commerce.db"),
    });
    await assert.rejects(
      service.dropDatabase("demo-alias", "commerce.db"),
      /示例数据库/,
    );
    await tables(service);
    await assert.rejects(service.dropDatabase("target", "source.db"), /请选择/);
    const filename = path.join(directory, "target.db"),
      original = await fs.readFile(filename);
    await fs.writeFile(
      filename,
      Buffer.concat([original, Buffer.from("changed")]),
    );
    await assert.rejects(
      service.dropDatabase("target", "target.db"),
      /其他进程/,
    );
    await fs.writeFile(filename, original);
    assert.equal(
      (await service.table("target", pair("items_0").target)).total,
      2,
    );
  }));
