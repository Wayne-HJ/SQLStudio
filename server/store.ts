import fs from "node:fs/promises";
import path from "node:path";
import type { Connection } from "../shared/types.js";
export interface SecretCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
export class ConnectionStore {
  constructor(
    private directory: string,
    private codec?: SecretCodec,
  ) {}
  async list(): Promise<Connection[]> {
    try {
      const records = JSON.parse(
        await fs.readFile(
          path.join(this.directory, "connections.json"),
          "utf8",
        ),
      ) as { encrypted?: string; connection?: Connection }[];
      return records
        .map((r) =>
          r.encrypted && this.codec
            ? JSON.parse(this.codec.decrypt(r.encrypted))
            : r.connection,
        )
        .filter(Boolean);
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw new Error("无法读取连接配置，请检查系统凭据存储。");
    }
  }
  async save(connection: Connection) {
    const list = await this.list();
    const next = list.filter((c) => c.id !== connection.id);
    next.push(connection);
    await this.write(next);
  }
  async remove(id: string) {
    await this.write((await this.list()).filter((c) => c.id !== id));
  }
  private async write(list: Connection[]) {
    await fs.mkdir(this.directory, { recursive: true });
    const records = list.map((connection) => {
      if (this.codec)
        return { encrypted: this.codec.encrypt(JSON.stringify(connection)) };
      // Browser development mode keeps secrets in memory only.
      const { password, uri, connected, ...publicConfig } = connection;
      return { connection: publicConfig };
    });
    const filename = path.join(this.directory, "connections.json");
    await fs.writeFile(filename + ".tmp", JSON.stringify(records, null, 2), {
      mode: 0o600,
    });
    await fs.rename(filename + ".tmp", filename);
  }
}
