import { createClient } from "redis";
import { redisAuthMode, redisConnectionMode } from "../shared/redis.js";
import type { Connection } from "../shared/types.js";

export function redisDatabaseIndex(value: string): number | undefined {
  const input = value.trim();
  if (!input) return undefined;
  const index = Number(input);
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(index))
    throw new Error("Redis 数据库编号必须是非负整数");
  return index;
}

export function redisClientOptions(config: Connection) {
  let host = config.host;
  let port = config.port;
  let tls = config.ssl;
  const auth = redisAuthMode(config);
  let username = auth === "acl" ? config.username || undefined : undefined;
  let password = auth === "none" ? undefined : config.password || undefined;
  let database: number | undefined;
  if (redisConnectionMode(config) === "uri") {
    if (!config.uri) throw new Error("请填写 Redis 连接 URI");
    let url: URL;
    try {
      url = new URL(config.uri);
      if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname)
        throw new Error();
      host = url.hostname.replace(/^\[|\]$/g, "");
      port = Number(url.port || 6379);
      tls = url.protocol === "rediss:";
      username = decodeURIComponent(url.username) || undefined;
      password = decodeURIComponent(url.password) || undefined;
    } catch {
      throw new Error(
        "Redis 连接 URI 格式不正确，请使用 redis:// 或 rediss://",
      );
    }
    database = redisDatabaseIndex(url.pathname.slice(1));
  } else database = redisDatabaseIndex(config.database);
  return {
    // RESP2 sends AUTH for a named ACL user even when its password is empty,
    // and remains compatible with Redis servers predating HELLO/RESP3.
    RESP: 2 as const,
    socket: {
      host,
      port,
      connectTimeout: 10000,
      reconnectStrategy: false as const,
      ...(tls ? { tls: true as const } : {}),
    },
    username,
    password,
    database,
  };
}

export function redisMetadataUnavailable(error: unknown) {
  return (
    error instanceof Error &&
    /^(NOPERM\b|ERR (unknown command|unsupported command|command .* (disabled|not allowed)))/i.test(
      error.message,
    )
  );
}

const restrictedNotice =
  "无权读取完整数据库列表，仅显示当前数据库。请授予 CONFIG GET 或 SELECT 权限。";
const unavailableNotice = "当前服务未提供完整数据库列表，仅显示当前数据库。";
const maxDatabases = 65536;
const databaseNames = (count: number) =>
  Array.from({ length: count }, (_, index) => String(index));

export async function redisDatabases(
  client: ReturnType<typeof createClient>,
  selected: string,
): Promise<{ names: string[]; notice?: string }> {
  let clusterKnown = false;
  try {
    const info = await client.info("cluster");
    if (/^cluster_enabled:1\r?$/m.test(info)) return { names: ["0"] };
    clusterKnown = /^cluster_enabled:0\r?$/m.test(info);
  } catch (error) {
    if (!redisMetadataUnavailable(error)) throw error;
  }
  try {
    const config = await client.configGet("databases");
    const count = Number(config.databases);
    if (!clusterKnown) {
      try {
        const cluster = await client.configGet("cluster-enabled");
        if (["yes", "1"].includes(cluster["cluster-enabled"]))
          return { names: ["0"] };
      } catch (error) {
        if (!redisMetadataUnavailable(error)) throw error;
      }
    }
    if (Number.isSafeInteger(count) && count > maxDatabases)
      return { names: [selected], notice: unavailableNotice };
    if (Number.isSafeInteger(count) && count > 0)
      return { names: databaseNames(count) };
  } catch (error) {
    if (!redisMetadataUnavailable(error)) throw error;
  }

  // Restricted services often disallow CONFIG. Probe on a separate connection
  // so discovery never changes the database used by open key tabs or queries.
  const probe = client.duplicate({ database: 0 });
  probe.on("error", () => {});
  try {
    await probe.connect();
    const selectable = async (index: number) => {
      try {
        await probe.select(index);
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          /DB index is out of range|SELECT is not allowed in cluster mode/i.test(
            error.message,
          )
        )
          return false;
        throw error;
      }
    };
    let lower = 0;
    let upper = 1;
    while (await selectable(upper)) {
      // Some hosted Redis services treat SELECT as a no-op for every index.
      // Stop probing rather than looping forever or inventing database numbers.
      if (upper >= maxDatabases)
        return { names: [selected], notice: unavailableNotice };
      lower = upper;
      upper *= 2;
    }
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      if (await selectable(middle)) lower = middle;
      else upper = middle;
    }
    return { names: databaseNames(upper) };
  } catch (error) {
    if (redisMetadataUnavailable(error))
      return { names: [selected], notice: restrictedNotice };
    throw error;
  } finally {
    if (probe.isOpen) probe.destroy();
  }
}
