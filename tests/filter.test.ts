import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseService, demoConnection } from "../server/service.js";
import { createDispatcher } from "../server/rpc.js";
import type { TableFilter } from "../shared/types.js";
const object = { name: "items", type: "table" as const };
async function fixture(run: (service: DatabaseService) => Promise<void>) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sqlstudio-filters-"),
  );
  const service = new DatabaseService(directory);
  try {
    await service.connect({
      ...demoConnection,
      id: "filters",
      filePath: path.join(directory, "items.db"),
    });
    await service.query(
      "filters",
      "CREATE TABLE items (id INTEGER PRIMARY KEY,name TEXT,status TEXT,score REAL,deleted_at TEXT)",
    );
    const rows = [
      [1, "alpha", "active", 10, null],
      [2, "alphabet", "inactive", 20, null],
      [3, "beta", "active", 30, "2026-10-07"],
      [4, "literal_%!'", "active", 40, null],
      [5, "O'Reilly", "inactive", 50, null],
      [6, "", "active", 60, null],
      [7, "needle' OR 1=1 --", "active", 70, null],
    ];
    for (const [id, name, status, score, deleted_at] of rows)
      await service.insertRow("filters", object, {
        id,
        name,
        status,
        score,
        deleted_at,
      });
    await run(service);
  } finally {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
const filter = (
  conditions: TableFilter["conditions"],
  mode: TableFilter["mode"] = "and",
): TableFilter => ({ mode, conditions });
test("column conditions combine AND, numeric ranges, sorting and paging", () =>
  fixture(async (service) => {
    const conditions = filter([
      { column: "status", operator: "eq", value: "active" },
      { column: "score", operator: "between", value: "15", valueTo: "45" },
    ]);
    const page = await service.table(
      "filters",
      object,
      2,
      1,
      "id",
      "desc",
      "",
      conditions,
    );
    assert.equal(page.total, 2);
    assert.deepEqual(
      page.rows.map((r) => r.id),
      [3],
    );
  }));
test("OR conditions keep keyword search grouped and combine with it using AND", () =>
  fixture(async (service) => {
    const conditions = filter(
      [
        { column: "status", operator: "eq", value: "inactive" },
        { column: "id", operator: "gte", value: "6" },
      ],
      "or",
    );
    const page = await service.table(
      "filters",
      object,
      2,
      2,
      "id",
      "desc",
      "",
      conditions,
    );
    assert.equal(page.total, 4);
    assert.deepEqual(
      page.rows.map((r) => r.id),
      [5, 2],
    );
    const keyword = await service.table(
      "filters",
      object,
      1,
      50,
      "id",
      "asc",
      "alpha",
      filter([{ column: "status", operator: "eq", value: "active" }]),
    );
    assert.deepEqual(
      keyword.rows.map((r) => r.id),
      [1],
    );
  }));
test("contains treats percent, underscore, escape marker and quotes literally", () =>
  fixture(async (service) => {
    for (const value of ["_%", "!'"]) {
      const page = await service.table(
        "filters",
        object,
        1,
        50,
        undefined,
        "asc",
        "",
        filter([{ column: "name", operator: "contains", value }]),
      );
      assert.deepEqual(
        page.rows.map((r) => r.id),
        [4],
      );
    }
    const starts = await service.table(
      "filters",
      object,
      1,
      50,
      "id",
      "asc",
      "",
      filter([{ column: "name", operator: "starts_with", value: "alpha" }]),
    );
    assert.deepEqual(
      starts.rows.map((r) => r.id),
      [1, 2],
    );
    const ends = await service.table(
      "filters",
      object,
      1,
      50,
      "id",
      "asc",
      "",
      filter([{ column: "name", operator: "ends_with", value: "beta" }]),
    );
    assert.deepEqual(
      ends.rows.map((r) => r.id),
      [3],
    );
  }));
test("NULL checks differ from empty strings and filters can be cleared", () =>
  fixture(async (service) => {
    const empty = await service.table(
      "filters",
      object,
      1,
      50,
      undefined,
      "asc",
      "",
      filter([{ column: "name", operator: "eq", value: "" }]),
    );
    assert.deepEqual(
      empty.rows.map((r) => r.id),
      [6],
    );
    const present = await service.table(
      "filters",
      object,
      1,
      50,
      undefined,
      "asc",
      "",
      filter([{ column: "deleted_at", operator: "is_not_null" }]),
    );
    assert.deepEqual(
      present.rows.map((r) => r.id),
      [3],
    );
    const missing = await service.table(
      "filters",
      object,
      1,
      50,
      undefined,
      "asc",
      "",
      filter([{ column: "deleted_at", operator: "is_null" }]),
    );
    assert.equal(missing.total, 6);
    assert.equal((await service.table("filters", object)).total, 7);
  }));
test("filter values cannot inject SQL; columns and operators are validated over RPC", () =>
  fixture(async (service) => {
    const dispatch = createDispatcher(service);
    const args = ["filters", object, 1, 50, null, "asc", ""];
    const result = (await dispatch("table", [
      ...args,
      filter([{ column: "name", operator: "eq", value: "needle' OR 1=1 --" }]),
    ])) as { total: number };
    assert.equal(result.total, 1);
    await assert.rejects(
      dispatch("table", [
        ...args,
        filter([{ column: 'name") OR 1=1 --', operator: "eq", value: "" }]),
      ]),
      /筛选列不存在/,
    );
    await assert.rejects(
      dispatch("table", [
        ...args,
        {
          mode: "and",
          conditions: [
            { column: "name", operator: "eq) OR 1=1 --", value: "" },
          ],
        },
      ]),
    );
    await assert.rejects(
      dispatch("table", [
        ...args,
        filter(
          Array.from({ length: 21 }, () => ({
            column: "id",
            operator: "eq",
            value: "1",
          })),
        ),
      ]),
    );
    assert.equal((await service.table("filters", object)).total, 7);
  }));
test("quoted column names are matched as identifiers instead of SQL text", () =>
  fixture(async (service) => {
    await service.query("filters", 'CREATE TABLE unusual ("a""b" TEXT)');
    const unusual = { name: "unusual", type: "table" as const };
    await service.insertRow("filters", unusual, { 'a"b': "matched" });
    const result = await service.table(
      "filters",
      unusual,
      1,
      50,
      undefined,
      "asc",
      "",
      filter([{ column: 'a"b', operator: "eq", value: "matched" }]),
    );
    assert.equal(result.total, 1);
  }));
