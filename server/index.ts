import express from "express";
import path from "node:path";
import { DatabaseService } from "./service.js";
import { createDispatcher, safeError } from "./rpc.js";
const service = new DatabaseService(path.resolve(".sqlstudio"));
const dispatch = createDispatcher(service);
const app = express();
app.use((req, res, next) => {
  if (!["localhost", "127.0.0.1"].includes(req.hostname)) {
    res.status(403).json({ error: "仅允许本地访问" });
    return;
  }
  if (
    req.headers.origin &&
    !["http://localhost:5173", "http://127.0.0.1:5173"].includes(
      req.headers.origin,
    )
  ) {
    res.status(403).json({ error: "来源不受信任" });
    return;
  }
  next();
});
app.use(express.json({ limit: "12mb" }));
app.get("/health", (_, res) => res.json({ ok: true }));
app.post("/api", async (req, res) => {
  const { method, args } = req.body ?? {};
  if (typeof method !== "string" || !Array.isArray(args)) {
    res.status(400).json({ error: "请求无效" });
    return;
  }
  try {
    res.json({ result: await dispatch(method, args) });
  } catch (error) {
    res.status(400).json({ error: safeError(error, args) });
  }
});
const server = app.listen(4321, "127.0.0.1", () =>
  console.log("SQLStudio database service: http://127.0.0.1:4321"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    server.close();
    await service.shutdown();
    process.exit(0);
  });
