import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseService, demoConnection } from "../server/service.js";
import { splitSql, sqlLiteral } from "../server/sql-files.js";
async function fixture(run: (service: DatabaseService) => Promise<void>) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sqlstudio-sqlfile-"),
  );
  const service = new DatabaseService(directory);
  try {
    await service.connect(demoConnection);
    await service.connect({
      ...demoConnection,
      id: "restore",
      name: "Restore",
      filePath: path.join(directory, "restore.db"),
    });
    await run(service);
  } finally {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test("SQL dump restores data, views, indexes and foreign keys to a new SQLite file", () =>
  fixture(async (service) => {
    const dump = await service.exportSql("demo");
    assert.equal(dump.tables, 7);
    assert.equal(dump.rows, 432);
    const imported = await service.importSql("restore", dump.sql);
    assert.equal(imported.transactional, true);
    assert.ok(imported.statements > 432);
    assert.equal((await service.objects("restore")).length, 8);
    assert.equal(
      (await service.table("restore", { name: "customers", type: "table" }))
        .total,
      128,
    );
    assert.equal(
      (await service.schema("restore", { name: "orders", type: "table" }))
        .foreignKeys[0].table,
      "customers",
    );
    assert.ok(
      (
        await service.schema("restore", { name: "customers", type: "table" })
      ).indexes.some((i) => i.name === "idx_customers_status"),
    );
  }));
test("SQL dump preserves semicolons, quotes, backslashes, NULL and binary values", () =>
  fixture(async (service) => {
    await service.query(
      "demo",
      "CREATE TABLE special (id INTEGER PRIMARY KEY,value TEXT,data BLOB)",
    );
    const value = "semi; quote' slash\\' literal --";
    await service.insertRow(
      "demo",
      { name: "special", type: "table" },
      { id: 1, value, data: null },
    );
    await service.query(
      "demo",
      "INSERT INTO special VALUES (2,NULL,X'00FFAA')",
    );
    const dump = await service.exportSql("demo", {
      name: "special",
      type: "table",
    });
    await service.importSql("restore", dump.sql);
    const result = await service.query(
      "restore",
      "SELECT id,value,hex(data) AS data FROM special ORDER BY id",
    );
    assert.equal(result.rows[0].value, value);
    assert.equal(result.rows[1].value, null);
    assert.equal(result.rows[1].data, "00FFAA");
    assert.equal(dump.tables, 1);
  }));
test("SQLite trigger with internal semicolons is imported as one statement", () =>
  fixture(async (service) => {
    const script =
      "CREATE TABLE t (id INTEGER PRIMARY KEY,v TEXT); CREATE TABLE log (v TEXT); CREATE TRIGGER change_log AFTER INSERT ON t BEGIN INSERT INTO log VALUES (NEW.v); INSERT INTO log VALUES ('second;value'); END; INSERT INTO t VALUES (1,'first');";
    assert.equal(splitSql(script).length, 4);
    await service.importSql("restore", script);
    assert.equal(
      (await service.query("restore", "SELECT * FROM log")).rows.length,
      2,
    );
  }));
test("SQL import rolls back table creation and earlier inserts on failure", () =>
  fixture(async (service) => {
    await assert.rejects(
      service.importSql(
        "restore",
        "CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1); INSERT INTO t VALUES (1);",
      ),
      /UNIQUE/,
    );
    assert.equal((await service.objects("restore")).length, 0);
  }));
test("SQL import validates foreign keys before commit and rejects DB switches", () =>
  fixture(async (service) => {
    await assert.rejects(
      service.importSql(
        "restore",
        "CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (p INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (99);",
      ),
      /外键/,
    );
    assert.equal((await service.objects("restore")).length, 0);
    await assert.rejects(
      service.importSql("restore", "BEGIN; SELECT 1; COMMIT;"),
      /不支持/,
    );
    await assert.rejects(
      service.importSql("restore", "USE another_database;"),
      /不支持/,
    );
  }));
test("splitter understands PostgreSQL dollar strings, quoted identifiers and comments", () => {
  const statements = splitSql(
    "-- one\nCREATE FUNCTION f() RETURNS text LANGUAGE sql AS $body$ SELECT 'semi; colon'; $body$; /* x; */ SELECT 'it''s; ok'; SELECT E'escape\\\';semicolon';",
  );
  assert.equal(statements.length, 3);
  assert.throws(() => splitSql("SELECT 'broken"), /未闭合/);
  assert.equal(sqlLiteral("O'Reilly", "postgres"), "'O''Reilly'");
});
test("table context actions quote names and delete only the selected object", () =>
  fixture(async (service) => {
    await service.query(
      "restore",
      'CREATE TABLE "a weird name" (id INTEGER PRIMARY KEY)',
    );
    const object = { name: "a weird name", type: "table" as const };
    await service.renameObject("restore", object, "renamed");
    assert.ok(
      (await service.objects("restore")).some((o) => o.name === "renamed"),
    );
    await service.dropObject("restore", { name: "renamed", type: "table" });
    assert.equal((await service.objects("restore")).length, 0);
    assert.equal((await service.objects("demo")).length, 8);
  }));
