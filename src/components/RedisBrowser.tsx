import { useEffect, useState } from "react";
import { RefreshCw, Search, Terminal } from "lucide-react";
import type { Connection, DbObject, TablePage } from "../../shared/types";
import { api } from "../api";
import RedisKeyTree from "./RedisKeyTree";
import RedisValueView from "./RedisValueView";
import { t } from "../i18n";

export default function RedisBrowser({
  connection,
  objects,
  onOpen,
  onRefresh,
  onCommand,
}: {
  connection: Connection;
  objects: DbObject[];
  onOpen: (object: DbObject) => void;
  onRefresh: () => void;
  onCommand: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DbObject>();
  const [data, setData] = useState<TablePage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keys = objects.filter((object) =>
    object.name.toLowerCase().includes(search.toLowerCase()),
  );
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError("");
    if (selected) {
      setBusy(true);
      void api
        .table(connection.id, selected, 1, 50)
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((error) => {
          if (!cancelled) setError(error.message);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [connection.id, connection.database, selected, objects]);
  return (
    <div className="redis-browser">
      <div className="redis-browser-toolbar">
        <strong>{t("Redis 键")}</strong>
        <button className="button" onClick={onCommand}>
          <Terminal size={14} />
          {t("数据库命令行")}
        </button>
        <button className="button" onClick={onRefresh}>
          <RefreshCw size={14} />
          {t("刷新")}
        </button>
      </div>
      <div className="redis-browser-body">
        <div className="redis-browser-keys">
          <label className="redis-key-search">
            <Search size={14} />
            <input
              aria-label={t("搜索 Redis 键")}
              placeholder={t("搜索 Redis 键")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <RedisKeyTree
            objects={keys}
            selected={selected?.name}
            onSelect={setSelected}
            onOpen={onOpen}
          />
          {!keys.length && <p className="redis-empty">{t("没有对象")}</p>}
        </div>
        <div className="redis-browser-value">
          {error ? (
            <div className="form-message error">{t(error)}</div>
          ) : selected ? (
            <RedisValueView
              name={selected.name}
              busy={busy}
              data={
                data ?? {
                  columns: [],
                  rows: [],
                  total: 0,
                  page: 1,
                  pageSize: 50,
                  affectedRows: 0,
                  elapsedMs: 0,
                }
              }
              onError={setError}
            />
          ) : (
            <div className="redis-empty">{t("选择一个键查看 JSON 数据")}</div>
          )}
        </div>
      </div>
      <div className="object-list-status">
        {t("{0} 个键", [keys.length])}
        <span>{connection.database}</span>
      </div>
    </div>
  );
}
