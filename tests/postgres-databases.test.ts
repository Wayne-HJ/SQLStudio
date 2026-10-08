import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { DatabaseService } from "../server/service.js";
import { createDispatcher } from "../server/rpc.js";
import type { Connection } from "../shared/types.js";

const connection: Connection = {
  id: "postgres-server",
  name: "PostgreSQL",
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "source",
  username: "test",
  ssl: false,
  color: "#5b7cfa",
  environment: "local",
};
async function fixture(
  run: (
    service: DatabaseService,
    calls: { database: string; sql: string; params: unknown[] }[],
    clients: FakeClient[],
  ) => Promise<void>,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sqlstudio-pg-"));
  const calls: { database: string; sql: string; params: unknown[] }[] = [],
    clients: FakeClient[] = [];
  class Client extends FakeClient {
    constructor(config: { database: string }) {
      super(config.database, calls);
      Object.setPrototypeOf(this, Client.prototype);
      clients.push(this);
    }
  }
  const factory = mock.method(
    pg,
    "Client",
    Client as unknown as typeof pg.Client,
  );
  const service = new DatabaseService(directory);
  try {
    await service.saveConnection(connection);
    await service.connect(connection);
    await run(service, calls, clients);
  } finally {
    await service.shutdown();
    factory.mock.restore();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
class FakeClient {
  ended = false;
  constructor(
    readonly database: string,
    readonly calls: { database: string; sql: string; params: unknown[] }[],
  ) {}
  on() {}
  async connect() {
    if (this.database === "denied")
      throw new Error("permission denied for database denied");
  }
  async end() {
    this.ended = true;
  }
  async query(input: string | { text: string }, params: unknown[] = []) {
    const sql = typeof input === "string" ? input : input.text;
    this.calls.push({ database: this.database, sql, params });
    if (sql === 'DROP DATABASE "blocked"')
      throw new Error("database is being accessed by other users");
    let rows: Record<string, unknown>[] = [];
    if (sql === "SHOW server_version") rows = [{ server_version: "17" }];
    else if (sql.includes("FROM pg_database"))
      rows = ["source", "target", 'odd"name', "postgres"].map((name) => ({
        name,
      }));
    else if (sql.includes("FROM information_schema.tables"))
      rows = [{ name: "items", schema: "public", type: "table" }];
    else if (sql.includes("FROM information_schema.columns"))
      rows = [{ name: "id", type: "integer", nullable: "NO", pk: true }];
    else if (sql.startsWith("SELECT *")) rows = [{ id: 1 }];
    return {
      rows,
      fields: Object.keys(rows[0] ?? {}).map((name) => ({ name })),
      rowCount: rows.length,
    };
  }
}

test("PostgreSQL lists databases and failed switching leaves the original session connected", () =>
  fixture(async (service) => {
    const dispatch = createDispatcher(service);
    assert.deepEqual(await dispatch("databases", [connection.id]), {
      names: ["source", "target", 'odd"name', "postgres"],
      selected: "source",
    });
    await assert.rejects(
      service.selectDatabase(connection.id, "denied"),
      /permission denied/,
    );
    assert.equal((await service.databases(connection.id)).selected, "source");
    await service.selectDatabase(connection.id, "target");
    assert.equal((await service.databases(connection.id)).selected, "target");
    assert.equal(
      (await service.connections()).find((c) => c.id === connection.id)
        ?.database,
      "source",
    );
  }));

test("PostgreSQL batch plans reopen their original databases after the browser switches", () =>
  fixture(async (service, calls, clients) => {
    const source = { connectionId: connection.id, database: "source" },
      target = { connectionId: connection.id, database: "target" };
    const tables = [
      {
        source: { name: "items", type: "table" as const, schema: "public" },
        target: { name: "items", type: "table" as const, schema: "public" },
      },
    ];
    assert.equal((await service.databaseObjects(target))[0].name, "items");
    assert.equal((await service.databases(connection.id)).selected, "source");
    const plan = await service.compareDatabaseData(source, target, tables);
    await service.selectDatabase(connection.id, "postgres");
    calls.length = 0;
    assert.deepEqual(await service.applyDatabaseSync(plan.id, false), {
      inserted: 0,
      updated: 0,
      deleted: 0,
    });
    assert.ok(
      calls.some(
        (call) => call.database === "source" && call.sql.startsWith("SELECT *"),
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.database === "target" &&
          call.sql.startsWith("BEGIN TRANSACTION"),
      ),
    );
    assert.ok(
      calls.some((call) => call.database === "target" && call.sql === "COMMIT"),
    );
    assert.equal((await service.databases(connection.id)).selected, "postgres");
    assert.equal(clients.filter((client) => !client.ended).length, 1);
  }));

test("PostgreSQL drops an escaped database from a maintenance connection, closes its aliases and retains profiles", () =>
  fixture(async (service, calls, clients) => {
    const config = { ...connection, database: 'odd"name' };
    await service.saveConnection(config);
    await service.connect(config);
    await service.saveConnection({ ...config, id: "alias" });
    await service.connect({ ...config, id: "alias" });
    await service.dropDatabase(connection.id, 'odd"name');
    assert.ok(
      calls.some(
        (call) =>
          call.database === "postgres" &&
          call.sql === 'DROP DATABASE "odd""name"',
      ),
    );
    for (const id of [connection.id, "alias"]) {
      const saved = (await service.connections()).find((c) => c.id === id)!;
      assert.equal(saved.database, "postgres");
      assert.equal(saved.connected, false);
    }
    assert.ok(clients.every((client) => client.ended));
    await service.connect({ ...connection, database: "postgres" });
    await assert.rejects(
      service.dropDatabase(connection.id, "postgres"),
      /系统数据库/,
    );
  }));

test("a PostgreSQL server refusal restores sessions and leaves the saved database intact", () =>
  fixture(async (service) => {
    const config = { ...connection, database: "blocked" };
    await service.saveConnection(config);
    await service.connect(config);
    await assert.rejects(
      service.dropDatabase(connection.id, "blocked"),
      /other users/,
    );
    assert.equal((await service.databases(connection.id)).selected, "blocked");
    const saved = (await service.connections()).find(
      (c) => c.id === connection.id,
    )!;
    assert.equal(saved.database, "blocked");
    assert.equal(saved.connected, true);
  }));
