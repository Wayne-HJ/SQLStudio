import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const desktop = process.argv.includes("--desktop");
const children = [];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
function launch(executable, args, env = {}) {
  const child = spawn(executable, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 0));
  return child;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
launch(process.execPath, [path.resolve("node_modules/vite/bin/vite.js")]);
if (!desktop)
  launch(process.execPath, [
    require.resolve("tsx/cli"),
    "watch",
    "server/index.ts",
  ]);
else {
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ending; attempt++) {
    try {
      ready = (await fetch("http://127.0.0.1:5173")).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    console.error("Vite did not start in time");
    stop(1);
  } else launch(require("electron"), ["."], { SQLSTUDIO_DEV: "1" });
}
