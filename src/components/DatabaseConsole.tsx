import { useEffect, useRef, useState } from "react";
import { History, Loader2, Play, Terminal } from "lucide-react";
import type { Connection, QueryResult } from "../../shared/types";
import { api } from "../api";
import { t } from "../i18n";

interface ConsoleEntry {
  id: string;
  command: string;
  prompt: string;
  result?: QueryResult;
  error?: string;
}
export default function DatabaseConsole({
  connection,
  onLogs,
  onExecuted,
}: {
  connection: Connection;
  onLogs: () => void;
  onExecuted: () => Promise<void>;
}) {
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const output = useRef<HTMLDivElement>(null);
  const historyIndex = useRef<number | undefined>(undefined);
  const unfinished = useRef("");
  useEffect(() => {
    output.current?.scrollTo(0, output.current.scrollHeight);
  }, [entries, busy]);
  async function execute() {
    if (!connection.connected || busyRef.current || !command.trim()) return;
    const text = command.trim();
    const id = crypto.randomUUID();
    busyRef.current = true;
    setBusy(true);
    setCommand("");
    historyIndex.current = undefined;
    setEntries((previous) =>
      [...previous, { id, command: text, prompt }].slice(-100),
    );
    try {
      const result = await api.query(connection.id, text);
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === id ? { ...entry, result } : entry,
        ),
      );
      await onExecuted().catch(() => {});
    } catch (error) {
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === id
            ? { ...entry, error: (error as Error).message }
            : entry,
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }
  function recall(direction: number) {
    if (!entries.length) return;
    if (historyIndex.current === undefined) unfinished.current = command;
    const next = Math.max(
      0,
      Math.min(
        entries.length,
        (historyIndex.current ?? entries.length) + direction,
      ),
    );
    historyIndex.current = next;
    setCommand(
      next === entries.length ? unfinished.current : entries[next].command,
    );
  }
  const prompt = `${connection.engine} [${connection.database || "default"}] >`;
  return (
    <div className="database-console">
      <div className="console-toolbar">
        <Terminal size={17} />
        <strong>{t("数据库命令行")}</strong>
        <span>
          {connection.name} / {connection.database}
        </span>
        <button className="button" onClick={onLogs}>
          <History size={14} />
          {t("操作日志")}
        </button>
      </div>
      <div
        className="console-output"
        ref={output}
        role="log"
        aria-live="polite"
      >
        <p className="console-help">
          {t("输入命令后按 Ctrl / ⌘ + Enter 执行；Alt + ↑ / ↓ 调用历史命令。")}
        </p>
        <p className="console-help">
          {connection.engine === "redis"
            ? t(
                'Redis 支持文本命令和 JSON 参数数组，例如 PING 或 ["GET","key"]。',
              )
            : connection.engine === "mongodb"
              ? t("输入 MongoDB JSON 数据库命令。")
              : t("支持多行 SQL 命令。")}
        </p>
        {entries.map((entry) => (
          <article key={entry.id} className="console-entry">
            <pre className="console-command">
              <span>{entry.prompt} </span>
              {entry.command}
            </pre>
            {entry.error ? (
              <pre className="console-failure">{t(entry.error)}</pre>
            ) : entry.result ? (
              <>
                <pre className="console-result">
                  {entry.result.columns.length
                    ? JSON.stringify(
                        connection.engine === "redis"
                          ? entry.result.rows[0]?.result
                          : entry.result.rows,
                        null,
                        2,
                      )
                    : t("执行成功 · {0} 行受影响", [entry.result.affectedRows])}
                </pre>
                <span className="console-timing">
                  {entry.result.elapsedMs.toFixed(1)} ms
                  {entry.result.truncated ? ` · ${t("已截断到 1,000 行")}` : ""}
                </span>
              </>
            ) : (
              <span className="console-timing">{t("执行中")}</span>
            )}
          </article>
        ))}
      </div>
      <div className="console-input">
        <label htmlFor="database-command">{prompt}</label>
        <textarea
          id="database-command"
          ref={input}
          autoFocus
          rows={3}
          value={command}
          disabled={busy || !connection.connected}
          aria-label={t("数据库命令")}
          placeholder={
            connection.engine === "redis"
              ? "PING"
              : connection.engine === "mongodb"
                ? '{"collection":"customers","operation":"find"}'
                : "SELECT 1;"
          }
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.metaKey ||
                event.ctrlKey ||
                (connection.engine === "redis" && !event.shiftKey)) &&
              event.key === "Enter"
            ) {
              event.preventDefault();
              void execute();
            }
            if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault();
              recall(event.key === "ArrowUp" ? -1 : 1);
            }
          }}
        />
        <button
          className="button primary"
          disabled={busy || !connection.connected || !command.trim()}
          onClick={() => void execute()}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {t("执行")}
        </button>
      </div>
    </div>
  );
}
