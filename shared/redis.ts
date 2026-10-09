import type { Connection } from "./types.js";

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
