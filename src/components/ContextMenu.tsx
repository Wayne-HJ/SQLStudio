import { t } from "../i18n";
import { useEffect, useRef } from "react";
export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}
export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = Math.min(y, window.innerHeight - items.length * 31 - 24);
  const left = Math.min(x, window.innerWidth - 220);
  useEffect(() => {
    ref.current?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div
      className="context-menu-shield"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="context-menu"
        ref={ref}
        role="menu"
        tabIndex={-1}
        style={{ left: Math.max(4, left), top: Math.max(4, top) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item, i) => (
          <div key={t(item.label)}>
            {item.separator && i > 0 && (
              <div className="context-menu-separator" />
            )}
            <button
              role="menuitem"
              disabled={item.disabled}
              className={item.danger ? "danger" : ""}
              onClick={() => {
                onClose();
                item.action();
              }}
            >
              {item.icon}
              <span>{t(item.label)}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
