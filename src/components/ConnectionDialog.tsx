import { t } from "../i18n";
import { useState } from "react";
import {
  X,
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Cloud,
  FolderOpen,
  ShieldCheck,
  Loader2,
  Server,
  HardDrive,
  Leaf,
  Braces,
} from "lucide-react";
import { api } from "../api";
import type { Connection, Engine } from "../../shared/types";
import { redisAuthMode, redisConnectionMode } from "../../shared/redis";
export const engines: {
  id: Engine;
  name: string;
  subtitle: string;
  color: string;
  letter: string;
  port: number;
}[] = [
  {
    id: "mysql",
    name: "MySQL",
    subtitle: "MySQL / MariaDB",
    color: "#138ca8",
    letter: "My",
    port: 3306,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    subtitle: "PostgreSQL 及兼容服务",
    color: "#426cba",
    letter: "Pg",
    port: 5432,
  },
  {
    id: "sqlite",
    name: "SQLite",
    subtitle: "轻量本地数据库",
    color: "#7868c8",
    letter: "Sq",
    port: 0,
  },
  {
    id: "mongodb",
    name: "MongoDB",
    subtitle: "文档型数据库",
    color: "#24a16b",
    letter: "M",
    port: 27017,
  },
  {
    id: "redis",
    name: "Redis",
    subtitle: "键值与内存数据库",
    color: "#e36565",
    letter: "R",
    port: 6379,
  },
];
export function EngineIcon({
  engine,
  size = 28,
}: {
  engine: Engine;
  size?: number;
}) {
  const e = engines.find((e) => e.id === engine)!;
  return (
    <span
      className="engine-icon"
      style={{
        background: e.color + "12",
        color: e.color,
        width: size,
        height: size,
        fontSize: size * 0.38,
      }}
    >
      {e.letter}
    </span>
  );
}
const clouds = [
  {
    name: "Amazon RDS",
    engine: "mysql",
    desc: "MySQL / PostgreSQL",
    tag: "AWS",
  },
  { name: "Supabase", engine: "postgres", desc: "托管 PostgreSQL", tag: "S" },
  { name: "Neon", engine: "postgres", desc: "Serverless PostgreSQL", tag: "N" },
  {
    name: "MongoDB Atlas",
    engine: "mongodb",
    desc: "云端文档数据库",
    tag: "M",
  },
  { name: "TiDB Cloud", engine: "mysql", desc: "兼容 MySQL 协议", tag: "Ti" },
  {
    name: "Azure Database",
    engine: "postgres",
    desc: "托管 PostgreSQL",
    tag: "Az",
  },
] as const;
export default function ConnectionDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Connection;
  onClose: () => void;
  onSaved: (c: Connection) => void;
}) {
  const [step, setStep] = useState(initial ? 1 : 0);
  const [cloud, setCloud] = useState(false);
  const [config, setConfig] = useState<Connection>(
    initial ?? {
      id: crypto.randomUUID(),
      name: "",
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "",
      username: "postgres",
      ssl: false,
      color: "#5b7cfa",
      environment: "development",
    },
  );
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [tested, setTested] = useState(false);
  const redisUri =
    config.engine === "redis" && redisConnectionMode(config) === "uri";
  const redisAuth = redisAuthMode(config);
  const usesTls =
    redisUri && config.uri ? config.uri.startsWith("rediss://") : config.ssl;
  const patch = (p: Partial<Connection>) => {
    setConfig((c) => ({ ...c, ...p }));
    setTested(false);
    setMessage("");
  };
  const select = (engine: Engine, name?: string) => {
    const e = engines.find((e) => e.id === engine)!;
    patch({
      engine,
      port: e.port,
      name: name ?? t("我的 {0}", [e.name]),
      username:
        engine === "postgres" ? "postgres" : engine === "mysql" ? "root" : "",
      database: "",
      password: "",
      uri: "",
      redisAuth: engine === "redis" ? "none" : undefined,
      redisConnectionMode: engine === "redis" ? "host" : undefined,
      host: name ? "" : "localhost",
      ssl: !!name,
      environment: name ? "production" : "local",
    });
    setStep(1);
  };
  async function action(test = false) {
    setBusy(test ? "test" : "save");
    setMessage("");
    try {
      if (!config.name.trim()) throw new Error(t("请填写连接名称"));
      if (
        config.engine !== "sqlite" &&
        !redisUri &&
        !config.host.trim() &&
        !config.uri
      )
        throw new Error(t("请填写主机地址或连接 URI"));
      if (test) {
        const result = await api.test(config);
        setTested(true);
        setMessage(t("连接成功 · {0}", [result.version]));
      } else {
        const saved = await api.saveConnection(config);
        onSaved(saved);
      }
    } catch (error) {
      setTested(false);
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal connection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div className="modal-icon">
            <Database size={21} />
          </div>
          <div>
            <h2 id="connection-title">
              {initial ? t("编辑连接") : t("连接你的数据库")}
            </h2>
            <p>{t("从本地开发到云端生产，一个工作空间就够了。")}</p>
          </div>
          <button
            className="icon-button close"
            onClick={onClose}
            aria-label={t("关闭")}
          >
            <X size={19} />
          </button>
        </div>
        {step === 0 ? (
          <>
            <div className="segmented connection-segment">
              <button
                className={!cloud ? "active" : ""}
                onClick={() => setCloud(false)}
              >
                <Server size={15} />
                {t("数据库")}
              </button>
              <button
                className={cloud ? "active" : ""}
                onClick={() => setCloud(true)}
              >
                <Cloud size={15} />
                {t("云数据库")}
              </button>
            </div>
            <div className="engine-grid">
              {!cloud
                ? engines.map((e) => (
                    <button
                      className="engine-card"
                      key={e.id}
                      onClick={() => select(e.id)}
                    >
                      <EngineIcon engine={e.id} size={43} />
                      <strong>{e.name}</strong>
                      <span>{t(e.subtitle)}</span>
                      <ArrowRight size={16} />
                    </button>
                  ))
                : clouds.map((c) => (
                    <button
                      className="engine-card"
                      key={c.name}
                      onClick={() => select(c.engine, c.name)}
                    >
                      <span className="cloud-mark">{c.tag}</span>
                      <strong>{c.name}</strong>
                      <span>{t(c.desc)}</span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
            </div>
            <div className="connection-note">
              <ShieldCheck size={16} />
              <span>{t("直连数据库 · TLS 证书校验 · 桌面端系统加密存储")}</span>
            </div>
          </>
        ) : (
          <>
            <div className="selected-engine">
              <button
                className="icon-button"
                onClick={() => setStep(0)}
                aria-label={t("返回类型选择")}
              >
                <ArrowLeft size={17} />
              </button>
              <EngineIcon engine={config.engine} />
              <strong>
                {engines.find((e) => e.id === config.engine)?.name}
              </strong>
              <span>{usesTls ? t("TLS 安全连接") : t("标准连接")}</span>
            </div>
            <div className="connection-form">
              <label>
                {t("连接名称")}
                <input
                  value={config.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder={t("例如：Production / 开发环境")}
                  autoFocus
                />
              </label>
              {config.engine === "sqlite" ? (
                <label>
                  {t("数据库文件")}
                  <div className="input-action">
                    <input
                      value={config.filePath ?? ""}
                      onChange={(e) =>
                        patch({
                          filePath: e.target.value,
                          database:
                            e.target.value.split(/[/\\]/).at(-1) || "local.db",
                        })
                      }
                      placeholder={t("留空创建内存数据库；或输入 .db 文件路径")}
                    />
                    <button
                      onClick={async () => {
                        const file = await api.pickFile();
                        if (file)
                          patch({
                            filePath: file,
                            database: file.split(/[/\\]/).at(-1) || "local.db",
                          });
                      }}
                      title={t("桌面端选择文件")}
                    >
                      <FolderOpen size={17} />
                    </button>
                  </div>
                  <small>
                    {t("内存库关闭后不保留数据；填写路径可持久保存。")}
                  </small>
                </label>
              ) : (
                <>
                  {config.engine === "mongodb" && (
                    <label>
                      {t("连接 URI（可选）")}
                      <input
                        value={config.uri ?? ""}
                        onChange={(e) => patch({ uri: e.target.value })}
                        placeholder="mongodb+srv://user:password@cluster.example.net/"
                        type="password"
                        autoComplete="off"
                      />
                      <small>
                        {t("Atlas 请填完整 URI，并在下方填写数据库名称。")}
                      </small>
                    </label>
                  )}
                  {config.engine === "redis" && (
                    <label>
                      {t("连接方式")}
                      <select
                        value={redisConnectionMode(config)}
                        onChange={(e) =>
                          patch({
                            redisConnectionMode: e.target.value as
                              "host" | "uri",
                          })
                        }
                      >
                        <option value="host">{t("主机和端口")}</option>
                        <option value="uri">{t("连接 URI")}</option>
                      </select>
                    </label>
                  )}
                  {redisUri ? (
                    <label>
                      {t("连接 URI")}
                      <input
                        type="password"
                        value={config.uri ?? ""}
                        onChange={(e) => patch({ uri: e.target.value })}
                        autoComplete="new-password"
                        placeholder={
                          initial
                            ? t("留空保留已有 URI")
                            : "redis://localhost:6379"
                        }
                      />
                      <small>
                        {t(
                          "支持 redis:// 和 rediss://；认证信息和数据库编号均可省略。",
                        )}
                      </small>
                    </label>
                  ) : (
                    <>
                      <div className="form-row host-row">
                        <label>
                          {t("主机地址")}
                          <input
                            value={config.host}
                            onChange={(e) => patch({ host: e.target.value })}
                            placeholder={t("localhost 或云数据库地址")}
                          />
                        </label>
                        <label>
                          {t("端口")}
                          <input
                            type="number"
                            value={config.port}
                            onChange={(e) =>
                              patch({ port: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                      {config.engine === "redis" && (
                        <label>
                          {t("认证方式")}
                          <select
                            value={redisAuth}
                            onChange={(e) =>
                              patch({
                                redisAuth: e.target
                                  .value as Connection["redisAuth"],
                              })
                            }
                          >
                            <option value="none">{t("无认证")}</option>
                            <option value="password">{t("仅密码")}</option>
                            <option value="acl">
                              {t("用户名和密码（ACL）")}
                            </option>
                          </select>
                        </label>
                      )}
                      {(config.engine !== "redis" || redisAuth !== "none") && (
                        <div
                          className={
                            redisAuth === "password" &&
                            config.engine === "redis"
                              ? ""
                              : "form-row"
                          }
                        >
                          {(config.engine !== "redis" ||
                            redisAuth === "acl") && (
                            <label>
                              {t("用户名")}
                              <input
                                value={config.username}
                                onChange={(e) =>
                                  patch({ username: e.target.value })
                                }
                                autoComplete="off"
                              />
                              {config.engine === "redis" && (
                                <small>
                                  {t("可留空，使用 default 用户。")}
                                </small>
                              )}
                            </label>
                          )}
                          <label>
                            {t("密码")}
                            <input
                              type="password"
                              value={config.password ?? ""}
                              onChange={(e) =>
                                patch({ password: e.target.value })
                              }
                              placeholder={
                                initial
                                  ? t("留空保留已有密码")
                                  : t("数据库密码")
                              }
                              autoComplete="new-password"
                            />
                            {config.engine === "redis" &&
                              redisAuth === "acl" && (
                                <small>{t("ACL 用户无需密码时可留空。")}</small>
                              )}
                          </label>
                        </div>
                      )}
                      <label>
                        {config.engine === "redis"
                          ? t("默认数据库编号（可选）")
                          : t("数据库名称")}
                        <input
                          value={config.database}
                          onChange={(e) => patch({ database: e.target.value })}
                          placeholder={
                            config.engine === "redis"
                              ? t("留空使用 0，连接后选择数据库")
                              : config.engine === "mysql"
                                ? t("可留空，连接后选择数据库")
                                : t("例如 commerce")
                          }
                        />
                        {config.engine === "redis" && (
                          <small>
                            {t("连接后显示全部可用数据库编号，包括空数据库。")}
                          </small>
                        )}
                      </label>
                    </>
                  )}
                </>
              )}
              <div className="form-row">
                <label>
                  {t("环境")}
                  <select
                    value={config.environment}
                    onChange={(e) =>
                      patch({
                        environment: e.target
                          .value as Connection["environment"],
                      })
                    }
                  >
                    <option value="local">{t("本地")}</option>
                    <option value="development">{t("开发环境")}</option>
                    <option value="production">{t("生产环境")}</option>
                  </select>
                </label>
                <label>
                  {t("连接颜色")}
                  <div className="color-picker">
                    {[
                      "#5b7cfa",
                      "#28a77a",
                      "#e8a44f",
                      "#aa77dc",
                      "#e36565",
                    ].map((color) => (
                      <button
                        key={color}
                        style={{ background: color }}
                        className={config.color === color ? "selected" : ""}
                        onClick={() => patch({ color })}
                        aria-label={t("选择颜色 {0}", [color])}
                      >
                        {config.color === color && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
              {config.engine !== "sqlite" && !redisUri && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.ssl}
                    onChange={(e) => patch({ ssl: e.target.checked })}
                  />
                  <ShieldCheck size={16} />
                  <span>{t("启用 SSL / TLS（校验服务器证书）")}</span>
                </label>
              )}
              {message && (
                <div className={`form-message ${tested ? "success" : "error"}`}>
                  {tested && <Check size={16} />} {t(message)}
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button
                className="button"
                onClick={() => action(true)}
                disabled={!!busy}
              >
                {busy === "test" ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <ShieldCheck size={15} />
                )}
                {t("测试连接")}
              </button>
              <button
                className="button primary"
                onClick={() => action()}
                disabled={!!busy}
              >
                {busy === "save" ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <ArrowRight size={15} />
                )}
                {t("保存连接")}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
