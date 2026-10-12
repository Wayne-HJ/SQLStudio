import fs from "node:fs/promises";
import path from "node:path";
import type { OperationLogEntry } from "../shared/types.js";

export class OperationLogStore {
  constructor(private directory: string) {}
  async list(): Promise<OperationLogEntry[]> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.directory, "operations.json"), "utf8"),
      );
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async append(entry: OperationLogEntry) {
    const entries = [entry, ...(await this.list())].slice(0, 1000);
    await fs.mkdir(this.directory, { recursive: true });
    const filename = path.join(this.directory, "operations.json");
    await fs.writeFile(filename + ".tmp", JSON.stringify(entries), {
      mode: 0o600,
    });
    await fs.rename(filename + ".tmp", filename);
  }
}
