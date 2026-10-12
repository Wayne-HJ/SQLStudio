import { useEffect, useState } from "react";
import { History, RefreshCw, Search } from "lucide-react";
import type { OperationLogEntry } from "../../shared/types";
import { api } from "../api";
import { t, useLanguage } from "../i18n";

export default function OperationLogView() {
  const language = useLanguage();
  const [entries, setEntries] = useState<OperationLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setEntries(await api.operationLogs());
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const filtered = entries.filter(
    (entry) =>
      (status === "all" || entry.success === (status === "success")) &&
      `${entry.connectionName} ${entry.database} ${entry.commands.map((command) => `${command.text} ${JSON.stringify(command.parameters ?? [])}`).join(" ")} ${entry.error ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="operation-log-view">
      <div className="operation-log-heading">
        <History size={22} />
        <div>
          <h1>{t("操作日志")}</h1>
          <p>{t("最近 1,000 次数据库操作，保存在当前设备。")}</p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} className={busy ? "spin" : ""} />
          {t("刷新")}
        </button>
      </div>
      <div className="operation-log-filters">
        <label>
          <Search size={14} />
          <input
            aria-label={t("搜索操作日志")}
            placeholder={t("搜索命令、连接或数据库")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label={t("执行状态")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">{t("全部状态")}</option>
          <option value="success">{t("执行成功")}</option>
          <option value="failed">{t("执行失败")}</option>
        </select>
        <span>{t("{0} 条操作", [filtered.length])}</span>
      </div>
      {error && <div className="form-message error">{t(error)}</div>}
      <div className="operation-log-entries">
        {filtered.map((entry) => (
          <article className="operation-log-entry" key={entry.id}>
            <header>
              <span className={`tag ${entry.success ? "green" : "red"}`}>
                {entry.success ? t("执行成功") : t("执行失败")}
              </span>
              <strong>
                {entry.connectionName} / {entry.database}
              </strong>
              <span>{entry.engine.toUpperCase()}</span>
              <time>{new Date(entry.timestamp).toLocaleString(language)}</time>
              <span>{entry.elapsedMs.toFixed(1)} ms</span>
            </header>
            {entry.commands.map((command, index) => (
              <div key={index}>
                <pre>{command.text}</pre>
                {command.parameters && (
                  <div className="operation-parameters">
                    <span>{t("绑定参数")}</span>
                    <code>{JSON.stringify(command.parameters)}</code>
                  </div>
                )}
              </div>
            ))}
            {entry.error && (
              <pre className="operation-error">{t(entry.error)}</pre>
            )}
          </article>
        ))}
        {!busy && !filtered.length && (
          <div className="redis-empty">{t("暂无操作日志")}</div>
        )}
      </div>
    </div>
  );
}
