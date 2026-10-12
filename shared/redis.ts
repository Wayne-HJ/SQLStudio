import type { Connection, DbObject } from "./types.js";

export interface RedisKeyNode {
  name: string;
  path: string;
  object?: DbObject;
  children: Map<string, RedisKeyNode>;
}
export function redisKeyTree(objects: DbObject[]) {
  const root: RedisKeyNode = { name: "", path: "", children: new Map() };
  for (const object of objects) {
    let node = root;
    const parts = object.name.split(":");
    parts.forEach((name, index) => {
      if (!node.children.has(name))
        node.children.set(name, {
          name,
          path: parts.slice(0, index + 1).join(":"),
          children: new Map(),
        });
      node = node.children.get(name)!;
    });
    node.object = object;
  }
  return root;
}
export function redisJsonValue(value: unknown): unknown {
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function redisAuthMode(config: Connection) {
  return (
    config.redisAuth ??
    (config.username ? "acl" : config.password ? "password" : "none")
  );
}

export function redisConnectionMode(config: Connection) {
  return config.redisConnectionMode ?? (config.uri ? "uri" : "host");
}

export function normalizeRedisConnection(config: Connection): Connection {
  if (config.engine !== "redis") return config;
  const mode = redisConnectionMode(config);
  const auth = redisAuthMode(config);
  return {
    ...config,
    redisConnectionMode: mode,
    redisAuth: auth,
    ...(mode === "host" ? { uri: "" } : {}),
    ...(auth === "none" ? { username: "", password: "" } : {}),
    ...(auth === "password" ? { username: "" } : {}),
  };
}
