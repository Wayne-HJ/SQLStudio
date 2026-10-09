import { z } from "zod";
import { DatabaseService } from "./service.js";
import { filterOperators } from "../shared/types.js";
const id = z.string().min(1).max(100);
const text = z.string().max(1000000);
const connection = z.object({
  id,
  name: z.string().min(1).max(100),
  engine: z.enum(["mysql", "postgres", "sqlite", "mongodb", "redis"]),
  host: z.string().max(500),
  port: z.number().int().min(0).max(65535),
  database: z.string().max(500),
  username: z.string().max(500),
  password: z.string().max(10000).optional(),
  uri: z.string().max(10000).optional(),
  redisAuth: z.enum(["none", "password", "acl"]).optional(),
  redisConnectionMode: z.enum(["host", "uri"]).optional(),
  filePath: z.string().max(2000).optional(),
  ssl: z.boolean(),
  color: z.string().max(30),
  environment: z.enum(["local", "development", "production"]),
  connected: z.boolean().optional(),
});
const object = z.object({
  name: z.string().min(1).max(1000),
  schema: z.string().max(500).optional(),
  type: z.enum(["table", "view", "collection", "key"]),
  keyType: z.string().optional(),
});
const record = z.record(z.string(), z.unknown());
const database = z.string().min(1).max(500);
const scope = z.object({ connectionId: id, database }).strict();
const tablePairs = z
  .array(z.object({ source: object, target: object }).strict())
  .min(1)
  .max(500);
const definitions = {
  connections: z.tuple([]),
  saveConnection: z.tuple([connection]),
  removeConnection: z.tuple([id]),
  connect: z.tuple([connection]),
  disconnect: z.tuple([id]),
  test: z.tuple([connection]),
  databases: z.tuple([id]),
  selectDatabase: z.tuple([id, z.string().min(1).max(500)]),
  dropDatabase: z.tuple([id, database]),
  databaseObjects: z.tuple([scope]),
  objects: z.tuple([id]),
  schema: z.tuple([id, object]),
  table: z.tuple([
    id,
    object,
    z.number().int().positive(),
    z.number().int().min(1).max(500),
    z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
    z
      .enum(["asc", "desc"])
      .nullish()
      .transform((v) => v ?? undefined),
    text.nullish().transform((v) => v ?? undefined),
    z
      .object({
        mode: z.enum(["and", "or"]),
        conditions: z
          .array(
            z
              .object({
                column: z.string().min(1).max(1000),
                operator: z.enum(filterOperators),
                value: z.string().max(10000).optional(),
                valueTo: z.string().max(10000).optional(),
              })
              .strict(),
          )
          .max(20),
      })
      .strict()
      .nullish()
      .transform((v) => v ?? undefined),
  ]),
  query: z.tuple([id, text]),
  updateRow: z.tuple([id, object, record, record]),
  insertRow: z.tuple([id, object, record]),
  deleteRow: z.tuple([id, object, record]),
  importRows: z.tuple([id, object, z.array(record).min(1).max(10000)]),
  backup: z.tuple([id]),
  exportSql: z.tuple([id, object.optional()]),
  importSql: z.tuple([
    id,
    z
      .string()
      .min(1)
      .max(20 * 1024 * 1024),
  ]),
  renameObject: z.tuple([id, object, z.string().min(1).max(128)]),
  dropObject: z.tuple([id, object]),
  compareSchemas: z.tuple([id, id, object, object]),
  compareData: z.tuple([id, id, object, object]),
  applySync: z.tuple([id, z.boolean()]),
  compareDatabaseSchemas: z.tuple([scope, scope, tablePairs]),
  compareDatabaseData: z.tuple([scope, scope, tablePairs]),
  applyDatabaseSync: z.tuple([id, z.boolean()]),
};
export function createDispatcher(service: DatabaseService) {
  const queues = new Map<string, Promise<unknown>>();
  return async (method: string, args: unknown[]) => {
    if (!Object.hasOwn(definitions, method)) throw new Error("未知操作");
    const parsed = (definitions as any)[method].parse(args);
    // Serialize all local operations, including plans spanning two connections.
    const key = "database-service";
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => Reflect.apply((service as any)[method], service, parsed));
    queues.set(key, next);
    try {
      return await next;
    } finally {
      if (queues.get(key) === next) queues.delete(key);
    }
  };
}
export function safeError(error: unknown, args: unknown[] = []) {
  if (error instanceof z.ZodError) return "参数格式不正确，请检查输入。";
  let message = error instanceof Error ? error.message : "操作失败";
  for (const arg of args) {
    if (arg && typeof arg === "object") {
      for (const key of ["password", "uri"]) {
        const value = (arg as any)[key];
        if (typeof value === "string" && value.length)
          message = message.replaceAll(value, "[已隐藏]");
      }
    }
  }
  return message.replace(
    /((?:mongodb(?:\+srv)?|rediss?):\/\/)[^\s@]+@/g,
    "$1[已隐藏]@",
  );
}
