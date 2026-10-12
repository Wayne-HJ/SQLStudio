import { t } from "../i18n";

export default function JsonTree({ value }: { value: unknown }) {
  function render(
    value: unknown,
    key: string | undefined,
    comma: boolean,
    depth: number,
  ): React.ReactNode {
    const label =
      key === undefined ? null : (
        <>
          <span className="json-key">{JSON.stringify(key)}</span>
          <span>: </span>
        </>
      );
    if (value !== null && typeof value === "object") {
      const array = Array.isArray(value);
      const entries = Object.entries(value);
      const open = array ? "[" : "{";
      const close = array ? "]" : "}";
      if (!entries.length)
        return (
          <div className="json-line">
            {label}
            {open}
            {close}
            {comma && ","}
          </div>
        );
      return (
        <details className="json-node" open={depth < 3}>
          <summary aria-label={key ?? t("JSON 数据")}>
            <span>
              {label}
              {open}
              <span className="json-collapsed">
                {" "}
                … {close}
                {comma && ","}
              </span>
            </span>
          </summary>
          <div className="json-children">
            {entries.map(([name, child], i) => (
              <div key={name}>
                {render(
                  child,
                  array ? undefined : name,
                  i < entries.length - 1,
                  depth + 1,
                )}
              </div>
            ))}
          </div>
          <div className="json-line">
            {close}
            {comma && ","}
          </div>
        </details>
      );
    }
    return (
      <div className="json-line">
        {label}
        <span className={`json-${value === null ? "null" : typeof value}`}>
          {JSON.stringify(value) ?? "null"}
        </span>
        {comma && ","}
      </div>
    );
  }
  return <div className="json-tree">{render(value, undefined, false, 0)}</div>;
}
