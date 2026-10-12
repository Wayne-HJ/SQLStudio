import { Copy, KeyRound, Loader2 } from "lucide-react";
import type { TablePage } from "../../shared/types";
import { redisJsonValue } from "../../shared/redis";
import JsonTree from "./JsonTree";
import { t } from "../i18n";

export default function RedisValueView({
  name,
  data,
  busy,
  onError,
}: {
  name: string;
  data: TablePage;
  busy?: boolean;
  onError: (message: string) => void;
}) {
  const row = data.rows[0];
  if (busy)
    return (
      <div className="redis-value-view redis-loading">
        <Loader2 size={20} className="spin" />
        {t("正在读取…")}
      </div>
    );
  if (!row || row.key !== name)
    return <div className="redis-value-view">{t("暂无数据")}</div>;
  const value = { [name]: redisJsonValue(row.value) };
  return (
    <div className="redis-value-view">
      <div className="redis-value-toolbar">
        <KeyRound size={16} />
        <strong>{name}</strong>
        <span className="tag">{String(row.type)}</span>
        <span className="redis-ttl">
          {row.ttl === -1
            ? t("永不过期")
            : row.ttl === -2
              ? t("键已过期或不存在")
              : t("剩余 {0} 秒", [row.ttl])}
        </span>
        <button
          className="button text"
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify(value, null, 2))
              .catch((error) => onError(error.message));
          }}
        >
          <Copy size={13} />
          {t("复制 JSON")}
        </button>
      </div>
      {data.truncated && (
        <div className="redis-value-notice">
          {t("仅显示前 {0} / {1} 项，请使用命令行读取其余数据。", [
            Array.isArray(row.value) ? row.value.length : 0,
            row.length,
          ])}
        </div>
      )}
      <JsonTree value={value} />
    </div>
  );
}
