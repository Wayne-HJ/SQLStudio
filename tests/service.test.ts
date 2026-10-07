import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService, demoConnection } from "../server/service.js";
import { ConnectionStore } from "../server/store.js";
import { createDispatcher, safeError } from "../server/rpc.js";
import type {
  Connection,
  DbObject,
  TablePage,
  QueryResult,
} from "../shared/types.js";
const customers: DbObject = { name: "customers", type: "table" };
async function fixture(
  run: (service: DatabaseService, directory: string) => Promise<void>,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sqlstudio-test-"));
  const service = new DatabaseService(directory);
  try {
    await service.connect(demoConnection);
    await run(service, directory);
  } finally {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test("SQLite demo has real tables, views, primary keys and foreign keys", () =>
  fixture(async (service) => {
    const objects = await service.objects("demo");
    assert.equal(objects.length, 8);
    assert.ok(objects.some((o) => o.type === "view"));
    const info = await service.schema("demo", customers);
    assert.equal(info.columns.length, 8);
    assert.ok(info.columns.find((c) => c.name === "id")?.primaryKey);
    const orders = await service.schema("demo", {
      name: "orders",
      type: "table",
    });
    assert.deepEqual(orders.foreignKeys, [
      { column: "customer_id", table: "customers", foreignColumn: "id" },
    ]);
  }));
test("SQLite rejects unapplied WAL at connect and before replacing a file", () =>
  fixture(async (service, directory) => {
    const filename = path.join(directory, "commerce.db");
    const original = await fs.readFile(filename);
    await fs.writeFile(filename + "-wal", Buffer.from("unapplied-wal"));
    try {
      await assert.rejects(
        service.connect({ ...demoConnection, id: "wal", filePath: filename }),
        /WAL/,
      );
      await assert.rejects(
        service.updateRow("demo", customers, { id: 1 }, { company: "Blocked" }),
        /WAL/,
      );
      assert.deepEqual(await fs.readFile(filename), original);
    } finally {
      await fs.rm(filename + "-wal");
    }
    await service.disconnect("demo");
    assert.deepEqual(await fs.readFile(filename), original);
    await service.connect(demoConnection);
    assert.equal(
      (await service.query("demo", "SELECT company FROM customers WHERE id=1"))
        .rows[0].company,
      "Linear",
    );
  }));
test("data browser paginates, filters with bound values and sorts", () =>
  fixture(async (service) => {
    const first = await service.table("demo", customers, 1, 25, "id", "asc");
    const second = await service.table("demo", customers, 2, 25, "id", "asc");
    assert.equal(first.total, 128);
    assert.equal(first.rows.length, 25);
    assert.equal(second.rows[0].id, 26);
    const filtered = await service.table(
      "demo",
      customers,
      1,
      50,
      "id",
      "desc",
      "Olivia",
    );
    assert.equal(filtered.total, 8);
    assert.ok(Number(filtered.rows[0].id) > Number(filtered.rows[1].id));
    const injection = await service.table(
      "demo",
      customers,
      1,
      50,
      undefined,
      "asc",
      "' OR 1=1 --",
    );
    assert.equal(injection.total, 0);
  }));
test("SQL joins and result limits work", () =>
  fixture(async (service) => {
    const result = await service.query(
      "demo",
      "SELECT c.name, COUNT(o.id) AS orders FROM customers c LEFT JOIN orders o ON c.id=o.customer_id GROUP BY c.id",
    );
    assert.equal(result.rows.length, 128);
    const large = await service.query(
      "demo",
      "WITH RECURSIVE t(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM t WHERE x<1200) SELECT x FROM t",
    );
    assert.equal(large.rows.length, 1000);
    assert.equal(large.truncated, true);
  }));
test("row writes require full primary key and preserve other rows", () =>
  fixture(async (service) => {
    await assert.rejects(
      service.updateRow("demo", customers, {}, { company: "changed" }),
      /完整主键/,
    );
    await assert.rejects(
      service.updateRow(
        "demo",
        customers,
        { name: "Olivia Chen" },
        { company: "changed" },
      ),
      /完整主键/,
    );
    await service.updateRow(
      "demo",
      customers,
      { id: 1 },
      { company: "O'Reilly" },
    );
    assert.equal(
      (await service.query("demo", "SELECT company FROM customers WHERE id=1"))
        .rows[0].company,
      "O'Reilly",
    );
    assert.equal(
      (await service.query("demo", "SELECT company FROM customers WHERE id=2"))
        .rows[0].company,
      "Vercel",
    );
    await service.insertRow("demo", customers, {
      name: "Test",
      email: "test@example.test",
      created_at: "2026-10-07",
    });
    assert.equal((await service.table("demo", customers)).total, 129);
    await service.deleteRow("demo", customers, { id: 129 });
    assert.equal((await service.table("demo", customers)).total, 128);
  }));
test("composite keys are enforced and parameterized", () =>
  fixture(async (service) => {
    await service.query(
      "demo",
      "CREATE TABLE composite (a TEXT,b INTEGER,value TEXT,PRIMARY KEY(a,b))",
    );
    const object: DbObject = { name: "composite", type: "table" };
    await service.insertRow("demo", object, { a: "a'", b: 1, value: "before" });
    await assert.rejects(
      service.deleteRow("demo", object, { a: "a'" }),
      /完整主键/,
    );
    await service.updateRow(
      "demo",
      object,
      { a: "a'", b: 1 },
      { value: "after" },
    );
    assert.equal(
      (await service.query("demo", "SELECT value FROM composite")).rows[0]
        .value,
      "after",
    );
  }));
test("CSV batch import rolls back on constraint failure", () =>
  fixture(async (service) => {
    const row = {
      name: "Imported",
      email: "same@example.test",
      created_at: "2026-10-07",
    };
    await assert.rejects(
      service.importRows("demo", customers, [row, row]),
      /UNIQUE/,
    );
    assert.equal((await service.table("demo", customers)).total, 128);
    assert.equal(
      (
        await service.importRows("demo", customers, [
          row,
          { ...row, email: "other@example.test" },
        ])
      ).imported,
      2,
    );
  }));
test("invalid CSV field in a later row does not partially import", () =>
  fixture(async (service) => {
    await assert.rejects(
      service.importRows("demo", customers, [
        {
          name: "Test",
          email: "unique@example.test",
          created_at: "2026-10-07",
        },
        { missing_column: "invalid" },
      ]),
      /字段/,
    );
    assert.equal((await service.table("demo", customers)).total, 128);
  }));
test("SQLite persists across reconnect and produces a valid backup", () =>
  fixture(async (service, directory) => {
    await service.updateRow(
      "demo",
      customers,
      { id: 1 },
      { company: "Persisted" },
    );
    await service.disconnect("demo");
    await service.connect(demoConnection);
    assert.equal(
      (await service.query("demo", "SELECT company FROM customers WHERE id=1"))
        .rows[0].company,
      "Persisted",
    );
    const backup = await service.backup("demo");
    const buffer = Buffer.from(backup.data, "base64");
    assert.equal(buffer.subarray(0, 15).toString(), "SQLite format 3");
    const file = path.join(directory, "backup.db");
    await fs.writeFile(file, buffer);
    const config: Connection = {
      ...demoConnection,
      id: "backup",
      filePath: file,
    };
    await service.connect(config);
    assert.equal((await service.table("backup", customers)).total, 128);
  }));
test("dispatcher accepts JSON null optional args and serializes transactions", () =>
  fixture(async (service) => {
    const dispatch = createDispatcher(service);
    const result = (await dispatch("table", [
      "demo",
      customers,
      1,
      50,
      null,
      "asc",
      "",
    ])) as TablePage;
    assert.equal(result.rows.length, 50);
    await assert.rejects(dispatch("shutdown", []), /未知操作/);
    await assert.rejects(
      dispatch("table", ["demo", customers, -1, 5000, null, "asc", ""]),
    );
    const row = {
      name: "Batch",
      email: "batch@example.test",
      created_at: "2026-10-07",
    };
    const [imported, queried] = await Promise.all([
      dispatch("importRows", ["demo", customers, [row]]) as Promise<{
        imported: number;
      }>,
      dispatch("query", [
        "demo",
        "SELECT COUNT(*) AS count FROM customers",
      ]) as Promise<QueryResult>,
    ]);
    assert.equal(imported.imported, 1);
    assert.equal(queried.rows[0].count, 129);
  }));
test("connection responses and unencrypted browser storage omit credentials", () =>
  fixture(async (service, directory) => {
    const config: Connection = {
      ...demoConnection,
      id: "local-test",
      name: "Local",
      password: "secret-test-password",
      uri: "mongodb://name:secret@localhost/test",
    };
    const response = await service.saveConnection(config);
    assert.equal("password" in response, false);
    assert.equal("uri" in response, false);
    const content = await fs.readFile(
      path.join(directory, "connections.json"),
      "utf8",
    );
    assert.ok(!content.includes("secret"));
    await service.removeConnection(config.id);
    assert.equal((await service.connections()).length, 1);
  }));
test("encrypted store roundtrips without plaintext on disk", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sqlstudio-store-"),
  );
  const codec = {
    encrypt: (s: string) => Buffer.from(s).toString("base64"),
    decrypt: (s: string) => Buffer.from(s, "base64").toString(),
  };
  const store = new ConnectionStore(directory, codec);
  try {
    await store.save({
      ...demoConnection,
      id: "encrypted",
      password: "private-test-value",
    });
    assert.ok(
      !(
        await fs.readFile(path.join(directory, "connections.json"), "utf8")
      ).includes("private-test-value"),
    );
    assert.equal((await store.list())[0].password, "private-test-value");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("error reporting redacts credentials", () => {
  assert.equal(
    safeError(new Error("Failed with secret-pass"), [
      { password: "secret-pass" },
    ]),
    "Failed with [已隐藏]",
  );
  assert.ok(
    !safeError(
      new Error("Connection failed mongodb://user:password@localhost"),
    ).includes("password"),
  );
});
test("disconnected sessions fail clearly and demo config is protected", () =>
  fixture(async (service) => {
    await assert.rejects(service.saveConnection(demoConnection), /覆盖/);
    await assert.rejects(service.removeConnection("demo"), /删除/);
    await service.disconnect("demo");
    await assert.rejects(service.query("demo", "SELECT 1"), /请先连接/);
  }));
