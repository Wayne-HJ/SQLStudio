import { useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  KeyRound,
} from "lucide-react";
import type { DbObject } from "../../shared/types";
import { redisKeyTree, type RedisKeyNode } from "../../shared/redis";
import { t } from "../i18n";

export default function RedisKeyTree({
  objects,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
  sidebar = false,
}: {
  objects: DbObject[];
  selected?: string;
  onSelect: (object: DbObject) => void;
  onOpen?: (object: DbObject) => void;
  onContextMenu?: (event: MouseEvent, object: DbObject) => void;
  sidebar?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function render(node: RedisKeyNode, depth: number) {
    const expanded = !collapsed.has(node.path);
    return (
      <div key={node.path} className="redis-tree-node">
        <div
          className={`redis-tree-line ${node.object && selected === node.object.name ? "active" : ""}`}
          style={{ paddingLeft: (sidebar ? 32 : 12) + depth * 16 }}
        >
          {node.children.size ? (
            <button
              className="redis-tree-toggle"
              aria-label={t("展开 / 折叠 {0}", [node.path])}
              aria-expanded={expanded}
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(node.path)) next.delete(node.path);
                  else next.add(node.path);
                  return next;
                })
              }
            >
              {expanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
          ) : (
            <span className="redis-tree-spacer" />
          )}
          <button
            className="redis-tree-key"
            title={node.path}
            onClick={() => {
              if (node.object) onSelect(node.object);
              else
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(node.path)) next.delete(node.path);
                  else next.add(node.path);
                  return next;
                });
            }}
            onDoubleClick={() => node.object && onOpen?.(node.object)}
            onContextMenu={(event) =>
              node.object && onContextMenu?.(event, node.object)
            }
          >
            {node.object ? <KeyRound size={13} /> : <FolderClosed size={13} />}
            <span>{node.name || '""'}</span>
            {!!node.children.size && <small>{node.children.size}</small>}
          </button>
        </div>
        {expanded &&
          [...node.children.values()].map((child) => render(child, depth + 1))}
      </div>
    );
  }
  return (
    <div className="redis-key-tree">
      {[...redisKeyTree(objects).children.values()].map((node) =>
        render(node, 0),
      )}
    </div>
  );
}
