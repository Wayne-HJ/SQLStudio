import { t } from "../i18n";
import { useState } from "react";
import {
  Check,
  Database,
  FileCode2,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, MySQL, PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { api } from "../api";
import type { Connection } from "../../shared/types";
export default function SqlImportDialog({
  connection,
  file,
  onClose,
  onImported,
}: {
  connection: Connection;
  file: { name: string; script: string };
  onClose: () => void;
  onImported: (statements: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function execute() {
    setBusy(true);
    setError("");
    try {
      await api.connect(connection);
      const result = await api.importSql(connection.id, file.script);
      onImported(result.statements);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal sql-import-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-heading">
          <div className="modal-icon">
            <FileCode2 size={20} />
          </div>
          <div>
            <h2>{t("导入 SQL 文件")}</h2>
            <p>
              {file.name} · {(new Blob([file.script]).size / 1024).toFixed(1)}{" "}
              KB · {t("{0} 行 SQL", [file.script.split("\n").length])}
            </p>
          </div>
          <button
            className="icon-button close"
            onClick={onClose}
            disabled={busy}
            aria-label={t("关闭")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="sql-import-body">
          <div className="sql-import-target">
            <Database size={16} />
            <strong>{connection.name}</strong>
            <span>{connection.database}</span>
          </div>
          <p className="sql-import-warning">
            <TriangleAlert size={15} />
            {connection.engine === "mysql"
              ? t(
                  "将直接执行文件中的 SQL。MySQL 结构语句会隐式提交，失败时可能已有部分变更生效。",
                )
              : t(
                  "将直接执行文件中的 SQL。SQLite / PostgreSQL 在事务中导入，语句失败时回滚。",
                )}
          </p>
          <CodeMirror
            value={file.script.slice(0, 50000)}
            height="300px"
            extensions={[
              sql({
                dialect:
                  connection.engine === "mysql"
                    ? MySQL
                    : connection.engine === "postgres"
                      ? PostgreSQL
                      : SQLite,
              }),
            ]}
            editable={false}
          />
          {file.script.length > 50000 && (
            <p className="muted">
              {t("预览显示前 50,000 个字符，导入会执行整个文件。")}
            </p>
          )}
          {error && <div className="form-message error">{t(error)}</div>}
        </div>
        <footer className="modal-footer">
          <button className="button" onClick={onClose} disabled={busy}>
            {t("取消")}
          </button>
          <button
            className="button primary"
            onClick={() => void execute()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            {t("执行导入")}
          </button>
        </footer>
      </section>
    </div>
  );
}
