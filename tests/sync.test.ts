import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService, demoConnection } from "../server/service.js";
import type { DbObject } from "../shared/types.js";
const object: DbObject = { name: "sync_items", type: "table" };
async function fixture(
  run: (service: DatabaseService, directory: string) => Promise<void>,
  check = false,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sqlstudio-sync-"));
  const service = new DatabaseService(directory);
  try {
    await service.connect(demoConnection);
    await service.connect({
      ...demoConnection,
      id: "target",
      name: "Target",
      database: "target.db",
      filePath: path.join(directory, "target.db"),
    });
    await service.query(
      "demo",
      "CREATE TABLE sync_items (id INTEGER PRIMARY KEY,name TEXT NOT NULL,qty INTEGER NOT NULL)",
    );
    await service.query(
      "target",
      `CREATE TABLE sync_items (id INTEGER PRIMARY KEY,name TEXT NOT NULL,qty INTEGER NOT NULL${check ? " CHECK(qty>=0)" : ""})`,
    );
    await service.query(
      "demo",
      "INSERT INTO sync_items VALUES (1,'Same',10),(2,'New',20),(3,'Insert',30)",
    );
    await service.query(
      "target",
      "INSERT INTO sync_items VALUES (1,'Same',10),(2,'Old',5),(4,'Extra',40)",
    );
    await run(service, directory);
  } finally {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test("structure compare detects types, NULL, defaults, keys and added fields", () =>
  fixture(async (service) => {
    await service.query(
      "demo",
      "ALTER TABLE sync_items ADD COLUMN note TEXT DEFAULT 'hello'",
    );
    const result = await service.compareSchemas(
      "demo",
      "target",
      object,
      object,
    );
    assert.ok(
      result.differences.some(
        (d) => d.field === "note" && d.kind === "missing",
      ),
    );
    assert.match(result.sql, /ADD COLUMN "note" TEXT DEFAULT 'hello'/);
    const missing = await service.compareSchemas("demo", "target", object, {
      name: "new_items",
      type: "table",
    });
    assert.match(missing.sql, /CREATE TABLE "new_items"/);
    assert.match(missing.sql, /PRIMARY KEY/);
  }));
test("data comparison produces keyed insert/update/delete differences", () =>
  fixture(async (service) => {
    const plan = await service.compareData("demo", "target", object, object);
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.sourceCount, 3);
    assert.equal(plan.targetCount, 3);
    assert.deepEqual(plan.primaryKeys, ["id"]);
    assert.deepEqual(
      plan.changes.map((c) => c.kind),
      ["update", "insert", "delete"],
    );
    assert.deepEqual(plan.changes[0].fields, ["name", "qty"]);
  }));
test("sync applies inserts and updates, preserving extra target records by default", () =>
  fixture(async (service) => {
    const plan = await service.compareData("demo", "target", object, object);
    assert.deepEqual(await service.applySync(plan.id, false), {
      inserted: 1,
      updated: 1,
      deleted: 0,
    });
    const rows = (
      await service.query("target", "SELECT * FROM sync_items ORDER BY id")
    ).rows;
    assert.equal(rows.length, 4);
    assert.equal(rows[1].name, "New");
    assert.equal(rows[3].name, "Extra");
    await assert.rejects(service.applySync(plan.id, false), /过期/);
  }));
test("optional deletion makes the target match source and survives reconnect", () =>
  fixture(async (service, directory) => {
    const plan = await service.compareData("demo", "target", object, object);
    assert.deepEqual(await service.applySync(plan.id, true), {
      inserted: 1,
      updated: 1,
      deleted: 1,
    });
    assert.deepEqual(
      (await service.query("target", "SELECT * FROM sync_items ORDER BY id"))
        .rows,
      (await service.query("demo", "SELECT * FROM sync_items ORDER BY id"))
        .rows,
    );
    await service.disconnect("target");
    await service.connect({
      ...demoConnection,
      id: "target",
      filePath: path.join(directory, "target.db"),
    });
    assert.deepEqual(
      (await service.query("target", "SELECT * FROM sync_items ORDER BY id"))
        .rows,
      (await service.query("demo", "SELECT * FROM sync_items ORDER BY id"))
        .rows,
    );
  }));
test("target changes after comparison cancel synchronization", () =>
  fixture(async (service) => {
    const plan = await service.compareData("demo", "target", object, object);
    await service.query(
      "target",
      "UPDATE sync_items SET name='Concurrent' WHERE id=2",
    );
    await assert.rejects(service.applySync(plan.id, true), /发生了变化/);
    assert.equal(
      (await service.query("target", "SELECT name FROM sync_items WHERE id=2"))
        .rows[0].name,
      "Concurrent",
    );
    assert.equal((await service.table("target", object)).total, 3);
  }));
test("source changes after comparison cancel synchronization", () =>
  fixture(async (service) => {
    const plan = await service.compareData("demo", "target", object, object);
    await service.query("demo", "UPDATE sync_items SET qty=99 WHERE id=3");
    await assert.rejects(service.applySync(plan.id, false), /发生了变化/);
    assert.equal(
      (await service.query("target", "SELECT name FROM sync_items WHERE id=2"))
        .rows[0].name,
      "Old",
    );
  }));
test("sync rolls back earlier writes when a later constraint fails", () =>
  fixture(async (service) => {
    await service.query("demo", "UPDATE sync_items SET qty=-1 WHERE id=3");
    const plan = await service.compareData("demo", "target", object, object);
    await assert.rejects(service.applySync(plan.id, false), /CHECK/);
    assert.equal(
      (await service.query("target", "SELECT name FROM sync_items WHERE id=2"))
        .rows[0].name,
      "Old",
    );
    assert.equal((await service.table("target", object)).total, 3);
  }, true));
test("sync rejects identical tables, mismatched fields and absent primary keys", () =>
  fixture(async (service) => {
    await assert.rejects(
      service.compareData("demo", "demo", object, object),
      /不能相同/,
    );
    await service.query(
      "target",
      "ALTER TABLE sync_items ADD COLUMN extra TEXT",
    );
    await assert.rejects(
      service.compareData("demo", "target", object, object),
      /字段名称/,
    );
    await service.query("demo", "CREATE TABLE no_key (name TEXT)");
    await service.query("target", "CREATE TABLE no_key (name TEXT)");
    await assert.rejects(
      service.compareData(
        "demo",
        "target",
        { name: "no_key", type: "table" },
        { name: "no_key", type: "table" },
      ),
      /完整主键/,
    );
  }));
test("external SQLite edits cannot be overwritten", () =>
  fixture(async (service, directory) => {
    const target = path.join(directory, "target.db");
    const existing = await fs.readFile(target);
    await fs.writeFile(
      target,
      Buffer.concat([existing, Buffer.from("external-change")]),
    );
    await assert.rejects(
      service.compareData("demo", "target", object, object),
      /其他进程/,
    );
    await fs.writeFile(target, existing);
  }));
