import { t } from "./i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Cloud,
  Code2,
  Copy,
  Database,
  Download,
  Ellipsis,
  FileCode2,
  FolderClosed,
  GitBranch,
  History,
  Info,
  KeyRound,
  Layers,
  LayoutGrid,
  Loader2,
  PanelLeftClose,
  PanelRightClose,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Table2,
  Terminal,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import {
  sql as sqlLanguage,
  MySQL,
  PostgreSQL,
  SQLite,
} from "@codemirror/lang-sql";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import Papa from "papaparse";
import ConnectionDialog, {
  EngineIcon,
  engines,
} from "./components/ConnectionDialog";
import DataGrid, { valueText, columnIcon } from "./components/DataGrid";
import { Structure, RelationGraph } from "./components/SchemaView";
import { api } from "./api";
import DesktopToolbar from "./components/DesktopToolbar";
import ObjectBrowser from "./components/ObjectBrowser";
import CompareWorkspace from "./components/CompareWorkspace";
import SqlImportDialog from "./components/SqlImportDialog";
import ContextMenu, { type MenuItem } from "./components/ContextMenu";
import TableFilterBuilder from "./components/TableFilterBuilder";
import AppIcon from "./components/AppIcon";
import { getLanguage, setLanguage, useLanguage } from "./i18n";
import type {
  Connection,
  DbObject,
  TableInfo,
  QueryResult,
  TablePage,
  HistoryEntry,
  SavedQuery,
  TableFilter,
} from "../shared/types";

const empty: QueryResult = {
  columns: [],
  rows: [],
  affectedRows: 0,
  elapsedMs: 0,
};
const emptyInfo: TableInfo = { columns: [], foreignKeys: [], indexes: [] };
const objectKey = (o: DbObject) => `${o.schema ?? ""}.${o.name}`;
const storage = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
function download(filename: string, body: BlobPart, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const editorTheme = EditorView.theme({
  "&": { fontSize: "13px", height: "100%" },
  ".cm-content": {
    fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
    padding: "20px 0",
    lineHeight: "1.85",
  },
  ".cm-gutters": {
    background: "#fafbfe",
    color: "#b1b7c7",
    borderRight: "1px solid #f0f1f5",
    minWidth: "48px",
  },
  ".cm-line": { padding: "0 18px" },
  ".cm-activeLine": { background: "#f6f8ff" },
  ".cm-activeLineGutter": { background: "#edf1fe" },
});
type Modal =
  | {
      kind: "confirm";
      title: string;
      description: string;
      action: () => Promise<void>;
      danger?: boolean;
    }
  | { kind: "row"; mode: "insert" | "edit"; row?: Record<string, unknown> }
  | { kind: "save" }
  | { kind: "settings" }
  | { kind: "rename"; connection: Connection; object: DbObject }
  | null;

export default function App() {
  const language = useLanguage();
  useEffect(() => {
    void window.desktop?.setLanguage(getLanguage()).catch(() => {});
  }, []);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeId, setActiveId] = useState("demo");
  const [objects, setObjects] = useState<DbObject[]>([]);
  const [databaseNames, setDatabaseNames] = useState<string[]>([]);
  const [activeDatabase, setActiveDatabase] = useState("");
  const [tabs, setTabs] = useState<DbObject[]>([]);
  const [route, setRoute] = useState("objects");
  const [queryOpened, setQueryOpened] = useState(false);
  useEffect(() => {
    if (route === "query") setQueryOpened(true);
  }, [route]);
  const [view, setView] = useState("data");
  const [info, setInfo] = useState<TableInfo>(emptyInfo);
  const [data, setData] = useState<TablePage>({
    ...empty,
    total: 0,
    page: 1,
    pageSize: 50,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filter, setFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [appliedConditions, setAppliedConditions] = useState<
    TableFilter | undefined
  >();
  const [showConditions, setShowConditions] = useState(false);
  const [sort, setSort] = useState("");
  const [direction, setDirection] = useState("asc");
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [showInspector, setShowInspector] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [connectionDialog, setConnectionDialog] = useState<
    Connection | null | false
  >(false);
  const [busy, setBusy] = useState(false);
  const [queryBusy, setQueryBusy] = useState(false);
  const [loadingConnection, setLoadingConnection] = useState("");
  const [version, setVersion] = useState("");
  const [queryText, setQueryText] = useState(
    "-- 探索你的数据，从一条查询开始。\nSELECT\n  c.name,\n  c.company,\n  COUNT(o.id) AS order_count,\n  ROUND(SUM(o.total), 2) AS total_spent\nFROM customers c\nLEFT JOIN orders o ON c.id = o.customer_id\nGROUP BY c.id\nORDER BY total_spent DESC\nLIMIT 100;",
  );
  const [queryResult, setQueryResult] = useState<QueryResult>(empty);
  const [queryError, setQueryError] = useState("");
  const [querySelected, setQuerySelected] = useState<number[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    storage("sqlstudio-history", []),
  );
  const [saved, setSaved] = useState<SavedQuery[]>(() =>
    storage("sqlstudio-saved", []),
  );
  const [schemas, setSchemas] = useState<Record<string, TableInfo>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [modalText, setModalText] = useState("");
  const [modalError, setModalError] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [exportMenu, setExportMenu] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const sqlImportRef = useRef<HTMLInputElement>(null);
  const [sqlFile, setSqlFile] = useState<{
    name: string;
    script: string;
    target: Connection;
  } | null>(null);
  const sqlTargetRef = useRef<Connection | null>(null);
  const [context, setContext] = useState<{
    kind: "connection" | "database" | "object";
    connection: Connection;
    object?: DbObject;
    x: number;
    y: number;
  } | null>(null);
  const [compareObject, setCompareObject] = useState<DbObject | undefined>();
  const editorRef = useRef<EditorView | null>(null);
  const activeRef = useRef("demo");
  const loadToken = useRef(0);
  const tableToken = useRef(0);
  const savedConnection = connections.find((c) => c.id === activeId);
  const connection = savedConnection
    ? { ...savedConnection, database: activeDatabase }
    : undefined;
  const object = tabs.find((o) => objectKey(o) === route);
  const connected = !!connection?.connected && loadingConnection !== activeId;
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [toast]);
  useEffect(() => {
    localStorage.setItem("sqlstudio-history", JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    localStorage.setItem("sqlstudio-saved", JSON.stringify(saved));
  }, [saved]);
  async function refreshConnections() {
    const list = await api.connections();
    setConnections(list);
    return list;
  }
  const resetTable = () => {
    setPage(1);
    setFilter("");
    setAppliedFilter("");
    setAppliedConditions(undefined);
    setShowConditions(false);
    setSort("");
    setSelected([]);
    setView("data");
  };
  function resetDatabaseWorkspace() {
    ++tableToken.current;
    setObjects([]);
    setTabs([]);
    setRoute("objects");
    setInfo(emptyInfo);
    setData({ ...empty, total: 0, page: 1, pageSize: 50 });
    setSchemas({});
    setCompareObject(undefined);
    setContext(null);
    setModal(null);
    setSqlFile(null);
    resetTable();
    setQueryResult(empty);
    setQueryError("");
  }
  async function activate(c: Connection) {
    const token = ++loadToken.current;
    activeRef.current = c.id;
    setActiveId(c.id);
    setLoadingConnection(c.id);
    setDatabaseNames([]);
    setActiveDatabase(c.database);
    resetDatabaseWorkspace();
    if (c.engine === "mongodb")
      setQueryText(
        '{\n  "collection": "customers",\n  "operation": "find",\n  "filter": {},\n  "limit": 100\n}',
      );
    else if (c.engine === "redis") setQueryText("PING");
    else if (c.id !== "demo")
      setQueryText("-- 使用 ⌘ / Ctrl + Enter 执行查询\nSELECT 1 AS connected;");
    try {
      const result = await api.connect(c);
      const catalog = await api.databases(c.id);
      const list = await api.objects(c.id);
      if (token !== loadToken.current) return;
      setVersion(result.version);
      setDatabaseNames(catalog.names);
      setActiveDatabase(catalog.selected);
      setObjects(list);
      setRoute("objects");
      await refreshConnections();
    } catch (error) {
      if (token === loadToken.current) notify((error as Error).message, true);
    } finally {
      if (token === loadToken.current) setLoadingConnection("");
    }
  }
  async function selectDatabase(database: string) {
    if (
      !connection ||
      database === activeDatabase ||
      loadingConnection ||
      busy ||
      queryBusy
    )
      return;
    const currentId = activeId;
    const token = ++loadToken.current;
    setLoadingConnection(currentId);
    try {
      await api.selectDatabase(currentId, database);
      if (token !== loadToken.current) return;
      setActiveDatabase(database);
      resetDatabaseWorkspace();
      const list = await api.objects(currentId);
      if (token === loadToken.current) setObjects(list);
    } catch (error) {
      if (token === loadToken.current) notify((error as Error).message, true);
    } finally {
      if (token === loadToken.current) setLoadingConnection("");
    }
  }
  useEffect(() => {
    let mounted = true;
    api
      .connections()
      .then((list) => {
        if (mounted) {
          setConnections(list);
          void activate(list[0]);
        }
      })
      .catch((e) => notify(e.message, true));
    return () => {
      mounted = false;
    };
  }, []);
  const loadTable = useCallback(async () => {
    if (!object || !connection?.connected) return;
    const token = ++tableToken.current;
    setBusy(true);
    setSelected([]);
    try {
      const [result, schema] = await Promise.all([
        api.table(
          activeId,
          object,
          page,
          pageSize,
          sort || undefined,
          direction,
          appliedFilter,
          appliedConditions,
        ),
        api.schema(activeId, object),
      ]);
      if (token === tableToken.current) {
        setData(result);
        setInfo(schema);
      }
    } catch (error) {
      if (token === tableToken.current) notify((error as Error).message, true);
    } finally {
      if (token === tableToken.current) setBusy(false);
    }
  }, [
    activeId,
    object,
    connection?.connected,
    page,
    pageSize,
    sort,
    direction,
    appliedFilter,
    appliedConditions,
    notify,
  ]);
  useEffect(() => {
    void loadTable();
    return () => {
      tableToken.current++;
    };
  }, [loadTable]);
  useEffect(() => {
    if (route !== "model" || !connected) return;
    let cancelled = false;
    setBusy(true);
    Promise.all(
      objects
        .filter((o) => o.type === "table")
        .map(async (o) => [o.name, await api.schema(activeId, o)] as const),
    )
      .then((entries) => {
        if (!cancelled) setSchemas(Object.fromEntries(entries));
      })
      .catch((e) => notify(e.message, true))
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route, activeId, objects, connected]);
  function openObject(o: DbObject) {
    setTabs((previous) =>
      previous.some((t) => objectKey(t) === objectKey(o))
        ? previous
        : [...previous, o],
    );
    resetTable();
    setRoute(objectKey(o));
  }
  function closeTab(o: DbObject) {
    const next = tabs.filter((t) => objectKey(t) !== objectKey(o));
    setTabs(next);
    if (route === objectKey(o)) {
      setRoute(
        next.length
          ? objectKey(next.at(-1)!)
          : queryOpened
            ? "query"
            : "objects",
      );
      resetTable();
    }
  }
  function closeQueryTab() {
    setQueryOpened(false);
    if (route === "query") {
      setRoute(tabs.length ? objectKey(tabs.at(-1)!) : "objects");
      resetTable();
    }
  }
  async function refreshObjects() {
    if (!connected) return;
    const token = loadToken.current;
    try {
      const catalog = await api.databases(activeId);
      const list = await api.objects(activeId);
      if (token !== loadToken.current) return;
      if (catalog.selected !== activeDatabase) resetDatabaseWorkspace();
      setActiveDatabase(catalog.selected);
      setDatabaseNames(catalog.names);
      setObjects(list);
      if (object && catalog.selected === activeDatabase) await loadTable();
      notify(t("数据库对象已刷新"));
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function runQuery() {
    if (!connection || queryBusy) return;
    const currentId = activeId;
    const token = loadToken.current;
    const selection = editorRef.current?.state.selection.main;
    const text =
      selection && !selection.empty
        ? editorRef.current!.state.doc.sliceString(selection.from, selection.to)
        : queryText;
    setQueryBusy(true);
    setQueryError("");
    let result: QueryResult | undefined;
    let error = "";
    const started = performance.now();
    try {
      result = await api.query(currentId, text);
      if (activeRef.current === currentId && token === loadToken.current) {
        const catalog = await api.databases(currentId);
        const list = await api.objects(currentId);
        if (token !== loadToken.current) return;
        if (catalog.selected !== activeDatabase) {
          resetDatabaseWorkspace();
          setRoute("query");
        }
        setActiveDatabase(catalog.selected);
        setDatabaseNames(catalog.names);
        setQueryResult(result);
        setQuerySelected([]);
        setObjects(list);
        notify(
          result.columns.length
            ? t("查询完成 · {0} 行{1}", [
                result.rows.length,
                result.truncated ? t("（结果已截断为 1,000 行）") : "",
              ])
            : t("执行成功 · {0} 行受影响", [result.affectedRows]),
        );
      }
    } catch (e) {
      error = (e as Error).message;
      if (activeRef.current === currentId && token === loadToken.current)
        setQueryError(error);
    } finally {
      setHistory((h) =>
        [
          {
            id: crypto.randomUUID(),
            sql: text,
            connectionId: currentId,
            connectionName: connection.name,
            timestamp: new Date().toISOString(),
            elapsedMs: result?.elapsedMs ?? performance.now() - started,
            rowCount: result?.rows.length ?? 0,
            success: !error,
            error,
          },
          ...h,
        ].slice(0, 100),
      );
      setQueryBusy(false);
    }
  }
  function requestQuery() {
    if (!connected) {
      notify(t("请先连接数据库"), true);
      return;
    }
    const selection = editorRef.current?.state.selection.main;
    const text =
      selection && !selection.empty
        ? editorRef.current!.state.doc.sliceString(selection.from, selection.to)
        : queryText;
    if (
      /\b(insert|update|delete|drop|alter|truncate|replace|create|grant|revoke|set|del|unlink|insertOne|updateOne|deleteOne)\b/i.test(
        text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ""),
      )
    )
      setModal({
        kind: "confirm",
        title: t("确认执行数据变更"),
        description: t(
          "查询包含写入或结构变更操作，将直接应用到「{0}」。请确认语句及目标数据库。",
          [connection?.name],
        ),
        action: runQuery,
        danger: true,
      });
    else void runQuery();
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        setConnectionDialog(false);
        setExportMenu(false);
        setContext(null);
        return;
      }
      if (modal || connectionDialog !== false || sqlFile) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        document.getElementById("object-search")?.focus();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        route === "query" &&
        !modal &&
        connectionDialog === false
      ) {
        event.preventDefault();
        requestQuery();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "n") {
        event.preventDefault();
        setConnectionDialog(null);
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "s" &&
        route === "query"
      ) {
        event.preventDefault();
        setModalText(t("未命名查询"));
        setModal({ kind: "save" });
      }
      if (event.key === "Escape") {
        setModal(null);
        setConnectionDialog(false);
        setExportMenu(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [route, queryText, queryBusy, connected, modal, connectionDialog]);
  function rowKey(row: Record<string, unknown>) {
    return Object.fromEntries(
      info.columns
        .filter((c) => c.primaryKey)
        .map((c) => [c.name, row[c.name]]),
    );
  }
  function editRow(index: number) {
    if (
      !object ||
      object.type !== "table" ||
      !["mysql", "postgres", "sqlite"].includes(connection?.engine ?? "")
    ) {
      notify(t("请使用查询编辑器修改此对象"), true);
      return;
    }
    if (!info.columns.some((c) => c.primaryKey)) {
      notify(t("此表没有主键，无法安全编辑"), true);
      return;
    }
    const row = data.rows[index];
    setModalText(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row).filter(
            ([k]) => !info.columns.find((c) => c.name === k)?.primaryKey,
          ),
        ),
        null,
        2,
      ),
    );
    setModalError("");
    setModal({ kind: "row", mode: "edit", row });
  }
  function insertRow() {
    if (!object) return;
    const values = Object.fromEntries(
      info.columns
        .filter((c) => !c.primaryKey && c.defaultValue == null)
        .map((c) => [
          c.name,
          c.nullable
            ? null
            : c.name.endsWith("_at")
              ? new Date().toISOString().slice(0, 19).replace("T", " ")
              : /int|real|decimal|numeric/i.test(c.type)
                ? 0
                : "",
        ]),
    );
    setModalText(JSON.stringify(values, null, 2));
    setModalError("");
    setModal({ kind: "row", mode: "insert" });
  }
  function deleteRows() {
    if (!selected.length || !object) return;
    setModal({
      kind: "confirm",
      title: t("删除 {0} 条记录？", [selected.length]),
      description: t(
        "将从 {0} 中永久删除选中的记录。此操作无法在应用内撤销。",
        [object.name],
      ),
      danger: true,
      action: async () => {
        for (const i of selected)
          await api.deleteRow(activeId, object, rowKey(data.rows[i]));
        await loadTable();
        notify(t("选中记录已删除"));
      },
    });
  }
  async function submitModal() {
    if (!modal) return;
    setModalBusy(true);
    setModalError("");
    try {
      if (modal.kind === "confirm") await modal.action();
      if (modal.kind === "row" && object) {
        const values = JSON.parse(modalText);
        if (!values || Array.isArray(values) || typeof values !== "object")
          throw new Error(t("请输入 JSON 对象"));
        if (modal.mode === "edit")
          await api.updateRow(activeId, object, rowKey(modal.row!), values);
        else await api.insertRow(activeId, object, values);
        await loadTable();
        notify(modal.mode === "edit" ? t("记录已更新") : t("记录已添加"));
      }
      if (modal.kind === "save") {
        if (!modalText.trim()) throw new Error(t("请输入查询名称"));
        setSaved((s) => [
          {
            id: crypto.randomUUID(),
            name: modalText.trim(),
            text: queryText,
            connectionId: activeId,
            updatedAt: new Date().toISOString(),
          },
          ...s,
        ]);
        notify(t("查询已保存到本地"));
      }
      if (modal.kind === "rename") {
        const { connection: c, object: o } = modal;
        const newName = modalText.trim();
        await api.renameObject(c.id, o, newName);
        if (c.id === activeId) {
          const renamed = { ...o, name: newName };
          setTabs((t) =>
            t.map((x) => (objectKey(x) === objectKey(o) ? renamed : x)),
          );
          if (route === objectKey(o)) setRoute(objectKey(renamed));
          setObjects(await api.objects(c.id));
        }
        notify(t("对象已重命名"));
      }
      setModal(null);
    } catch (error) {
      setModalError((error as Error).message);
    } finally {
      setModalBusy(false);
    }
  }
  async function importFile(file?: File) {
    if (!file || !object) return;
    const parsed = Papa.parse<Record<string, unknown>>(await file.text(), {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: true,
    });
    if (parsed.errors.length) {
      notify(t("CSV 格式错误：{0}", [parsed.errors[0].message]), true);
      return;
    }
    setModal({
      kind: "confirm",
      title: t("导入 {0} 条记录", [parsed.data.length]),
      description: t(
        "文件「{0}」将导入 {1}。首行应为与表字段一致的名称；同一批次遇到错误会回滚。",
        [file.name, object.name],
      ),
      action: async () => {
        const result = await api.importRows(activeId, object, parsed.data);
        await loadTable();
        notify(t("成功导入 {0} 条记录", [result.imported]));
      },
    });
  }
  function exportResult(format: "csv" | "json") {
    const result = route === "query" ? queryResult : data;
    const name = object?.name ?? "query-result";
    download(
      `${name}.${format}`,
      format === "csv"
        ? "\uFEFF" + Papa.unparse(result.rows)
        : JSON.stringify(result.rows, null, 2),
      format === "csv" ? "text/csv;charset=utf-8" : "application/json",
    );
    setExportMenu(false);
    notify(
      t("已导出当前{0} · {1} 行", [
        route === "query" ? t("查询结果") : t("页"),
        result.rows.length,
      ]),
    );
  }
  async function backup() {
    try {
      const result = await api.backup(activeId);
      const binary = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      download(result.filename, binary, "application/octet-stream");
      notify(t("SQLite 备份文件已导出"));
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function exportSql(c = connection, o?: DbObject) {
    if (!c) return;
    setBusy(true);
    try {
      await api.connect(c);
      const result = await api.exportSql(c.id, o);
      download(result.filename, result.sql, "application/sql;charset=utf-8");
      notify(
        t("已导出 SQL · {0} 个表 · {1} 条记录", [result.tables, result.rows]),
      );
      await refreshConnections();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function importSqlFile(file?: File) {
    const target = sqlTargetRef.current ?? connection;
    sqlTargetRef.current = null;
    if (!file || !target) return;
    if (file.size > 20 * 1024 * 1024) {
      notify(t("首版 SQL 文件导入上限为 20 MB"), true);
      return;
    }
    if (!["sqlite", "mysql", "postgres"].includes(target.engine)) {
      notify(t("SQL 导入支持 MySQL、PostgreSQL 和 SQLite"), true);
      return;
    }
    setSqlFile({ name: file.name, script: await file.text(), target });
  }
  function queryObject(o: DbObject, c: Connection) {
    const quote = (name: string) =>
      c.engine === "mysql"
        ? "`" + name.replaceAll("`", "``") + "`"
        : '"' + name.replaceAll('"', '""') + '"';
    setQueryText(
      c.engine === "mongodb"
        ? JSON.stringify(
            { collection: o.name, operation: "find", filter: {}, limit: 100 },
            null,
            2,
          )
        : c.engine === "redis"
          ? JSON.stringify(["GET", o.name])
          : `SELECT * FROM ${o.schema ? quote(o.schema) + "." : ""}${quote(o.name)}\nLIMIT 100;`,
    );
    setRoute("query");
  }
  function contextItems(): MenuItem[] {
    if (!context) return [];
    const c = context.connection,
      o = context.object;
    const relational = ["sqlite", "mysql", "postgres"].includes(c.engine);
    const importSQL = () => {
      sqlTargetRef.current = c;
      sqlImportRef.current?.click();
    };
    const openDatabase = async () => {
      if (c.id !== activeId) await activate(c);
      if (["mysql", "postgres"].includes(c.engine)) {
        await api.selectDatabase(c.id, c.database);
        resetDatabaseWorkspace();
        setActiveDatabase(c.database);
        setObjects(await api.objects(c.id));
      }
    };
    if (context.kind === "database")
      return [
        {
          label: t("打开数据库"),
          icon: <Database size={14} />,
          action: () =>
            void openDatabase().catch((e) => notify(e.message, true)),
        },
        {
          label: t("结构比对…"),
          icon: <Layers size={14} />,
          disabled: !relational,
          action: () =>
            void openDatabase()
              .then(() => {
                setCompareObject(undefined);
                setRoute("structure");
              })
              .catch((e) => notify(e.message, true)),
        },
        {
          label: t("数据同步…"),
          icon: <RefreshCw size={14} />,
          disabled: !relational,
          action: () =>
            void openDatabase()
              .then(() => {
                setCompareObject(undefined);
                setRoute("sync");
              })
              .catch((e) => notify(e.message, true)),
        },
        {
          label: t("导出数据库 SQL…"),
          icon: <ArrowDownToLine size={14} />,
          disabled: !relational,
          separator: true,
          action: () =>
            void openDatabase()
              .then(() => exportSql(c))
              .catch((e) => notify(e.message, true)),
        },
        {
          label: t("导入 SQL 文件…"),
          icon: <ArrowUpFromLine size={14} />,
          disabled: !relational,
          action: () =>
            void openDatabase()
              .then(importSQL)
              .catch((e) => notify(e.message, true)),
        },
        {
          label: c.engine === "redis" ? t("清空数据库…") : t("删除数据库…"),
          icon: <Trash2 size={14} />,
          danger: true,
          separator: true,
          disabled:
            c.id === "demo" ||
            !c.database ||
            (c.engine === "mysql" &&
              [
                "mysql",
                "sys",
                "information_schema",
                "performance_schema",
              ].includes(c.database.toLowerCase())) ||
            (c.engine === "postgres" &&
              ["postgres", "template0", "template1"].includes(
                c.database.toLowerCase(),
              )) ||
            (c.engine === "mongodb" &&
              ["admin", "config", "local"].includes(c.database.toLowerCase())),
          action: () => {
            setModalError("");
            setModal({
              kind: "confirm",
              title: t(
                c.engine === "redis" ? "清空数据库 {0}？" : "删除数据库 {0}？",
                [c.database],
              ),
              danger: true,
              description: t(
                c.engine === "sqlite"
                  ? "将永久删除「{0} / {1}」的数据库文件及全部数据。此操作无法在应用内撤销，连接配置将保留。"
                  : c.engine === "redis"
                    ? "将永久清空「{0} / {1}」中的全部键。此操作无法在应用内撤销，连接配置将保留。"
                    : "将永久删除「{0} / {1}」数据库及其中的全部表和数据。此操作无法在应用内撤销，连接配置将保留。",
                [c.name, c.database],
              ),
              action: async () => {
                await api.dropDatabase(c.id, c.database);
                const list = await refreshConnections();
                if (c.id === activeId) {
                  if (c.engine === "sqlite") await activate(list[0]);
                  else if (c.engine === "postgres")
                    await activate(
                      list.find((item) => item.id === c.id) ?? list[0],
                    );
                  else {
                    const catalog = await api.databases(c.id);
                    resetDatabaseWorkspace();
                    setActiveDatabase(catalog.selected);
                    setDatabaseNames(catalog.names);
                    setObjects(await api.objects(c.id));
                  }
                }
                notify(
                  t(c.engine === "redis" ? "数据库已清空" : "数据库已删除"),
                );
              },
            });
          },
        },
      ];
    if (o)
      return [
        {
          label: t("打开对象"),
          icon: <FolderClosed size={14} />,
          action: () => openObject(o),
        },
        {
          label: t("查看表结构"),
          icon: <Layers size={14} />,
          action: () => {
            openObject(o);
            setView("structure");
          },
        },
        {
          label: t("新建查询"),
          icon: <FileCode2 size={14} />,
          action: () => queryObject(o, c),
        },
        {
          label: t("导出对象 SQL…"),
          icon: <ArrowDownToLine size={14} />,
          action: () => void exportSql(c, o),
          disabled: !relational,
          separator: true,
        },
        {
          label: t("导入 SQL 文件…"),
          icon: <ArrowUpFromLine size={14} />,
          action: importSQL,
          disabled: !relational,
        },
        {
          label: t("导入 CSV 数据…"),
          icon: <ArrowUpFromLine size={14} />,
          action: () => {
            openObject(o);
            importRef.current?.click();
          },
          disabled: !relational || o.type !== "table",
        },
        {
          label: t("结构比对…"),
          icon: <Layers size={14} />,
          action: () => {
            setCompareObject(o);
            setRoute("structure");
          },
          disabled: !relational,
          separator: true,
        },
        {
          label: t("数据同步…"),
          icon: <RefreshCw size={14} />,
          action: () => {
            setCompareObject(o);
            setRoute("sync");
          },
          disabled: !relational || o.type !== "table",
        },
        {
          label: t("重命名…"),
          icon: <Settings2 size={14} />,
          action: () => {
            setModalText(o.name);
            setModalError("");
            setModal({ kind: "rename", connection: c, object: o });
          },
          disabled: o.type === "view",
          separator: true,
        },
        {
          label: t("删除对象…"),
          icon: <Trash2 size={14} />,
          danger: true,
          action: () =>
            setModal({
              kind: "confirm",
              title: t("删除 {0}？", [o.name]),
              description: t(
                "将从「{0} / {1}」永久删除{2}及其数据。此操作无法在应用内撤销。",
                [
                  c.name,
                  c.database,
                  o.type === "view"
                    ? t("视图")
                    : o.type === "collection"
                      ? t("集合")
                      : o.type === "key"
                        ? t("键")
                        : t("数据表"),
                ],
              ),
              danger: true,
              action: async () => {
                await api.dropObject(c.id, o);
                setTabs((t) => t.filter((x) => objectKey(x) !== objectKey(o)));
                if (route === objectKey(o)) setRoute("objects");
                await refreshObjects();
                notify(t("对象已删除"));
              },
            }),
        },
      ];
    return [
      {
        label: c.connected ? t("打开连接") : t("连接数据库"),
        icon: <Database size={14} />,
        action: () => void activate(c),
      },
      {
        label: t("断开连接"),
        icon: <X size={14} />,
        disabled: !c.connected,
        action: () => {
          void api
            .disconnect(c.id)
            .then(() => {
              if (c.id === activeId) {
                setObjects([]);
                setTabs([]);
                setRoute("objects");
              }
              return refreshConnections();
            })
            .catch((e) => notify(e.message, true));
        },
      },
      {
        label: t("编辑连接…"),
        icon: <Settings2 size={14} />,
        action: () => setConnectionDialog(c),
        disabled: c.id === "demo",
      },
      {
        label: t("新建查询"),
        icon: <FileCode2 size={14} />,
        action: () => {
          if (c.id === activeId) setRoute("query");
          else void activate(c).then(() => setRoute("query"));
        },
        separator: true,
      },
      {
        label: t("刷新对象"),
        icon: <RefreshCw size={14} />,
        action: () => {
          if (c.id === activeId) void refreshObjects();
          else void activate(c);
        },
      },
      {
        label: t("导出数据库 SQL…"),
        icon: <ArrowDownToLine size={14} />,
        action: () => void exportSql(c),
        disabled: !relational,
        separator: true,
      },
      {
        label: t("导入 SQL 文件…"),
        icon: <ArrowUpFromLine size={14} />,
        action: importSQL,
        disabled: !relational,
      },
      {
        label: t("结构比对…"),
        icon: <Layers size={14} />,
        action: () => {
          const go = () => {
            setCompareObject(undefined);
            setRoute("structure");
          };
          if (c.id === activeId) go();
          else void activate(c).then(go);
        },
        disabled: !relational,
      },
      {
        label: t("数据同步…"),
        icon: <RefreshCw size={14} />,
        action: () => {
          const go = () => {
            setCompareObject(undefined);
            setRoute("sync");
          };
          if (c.id === activeId) go();
          else void activate(c).then(go);
        },
        disabled: !relational,
      },
      {
        label: t("删除连接配置…"),
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: c.id === "demo",
        separator: true,
        action: () =>
          setModal({
            kind: "confirm",
            title: t("删除连接 {0}？", [c.name]),
            description: t("只删除本地连接配置，不会删除数据库和数据。"),
            danger: true,
            action: async () => {
              await api.removeConnection(c.id);
              const list = await refreshConnections();
              if (c.id === activeId) await activate(list[0]);
            },
          }),
      },
    ];
  }
  const writable =
    object?.type === "table" &&
    ["sqlite", "mysql", "postgres"].includes(connection?.engine ?? "");
  const hasPrimary = info.columns.some((c) => c.primaryKey);
  const rowsCount = route === "query" ? queryResult.rows.length : data.total;
  const filteredObjects = objects.filter((o) =>
    `${o.schema ?? ""}${o.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const tables = filteredObjects.filter((o) => o.type !== "view");
  const views = filteredObjects.filter((o) => o.type === "view");
  const currentName =
    object?.name ??
    {
      query: t("查询编辑器"),
      model: t("数据库关系图"),
      history: t("查询历史"),
      saved: t("已保存查询"),
      structure: t("结构比对"),
      sync: t("数据同步"),
      objects: t("对象"),
      views: t("视图"),
    }[route] ??
    t("工作空间");
  return (
    <div className="app-shell">
      <header
        className={`titlebar ${window.desktop?.platform === "darwin" ? "native-mac" : ""}`}
      >
        <div className="window-controls">
          {!window.desktop && (
            <>
              <i />
              <i />
              <i />
            </>
          )}
        </div>
        <div className="desktop-title">
          <AppIcon size={22} />
          SQLStudio
        </div>
        <button
          className="system-settings-button"
          title={t("系统设置")}
          onClick={() => setModal({ kind: "settings" })}
        >
          <Settings2 size={15} />
          <span>{t("系统设置")}</span>
        </button>
      </header>
      <DesktopToolbar
        active={route}
        onNavigate={(next) => {
          if (next === "structure" || next === "sync")
            setCompareObject(undefined);
          setRoute(next);
        }}
        onConnection={() => setConnectionDialog(null)}
        onBackup={() => void backup()}
        onImport={() => importRef.current?.click()}
        onExport={() => exportResult("csv")}
        onInspector={() => setShowInspector((v) => !v)}
        onImportSql={() => sqlImportRef.current?.click()}
        onExportSql={() => void exportSql()}
        connected={connected}
        sqlite={connection?.engine === "sqlite"}
      />
      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-title">
            <span>
              <Database size={15} />
              {t("我的连接")}
            </span>
            <button
              className="icon-button"
              onClick={() => setConnectionDialog(null)}
              title={t("新建连接")}
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="sidebar-search">
            <Search size={14} />
            <input
              id="object-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("搜索连接或对象…")}
            />
            <span>⌘ K</span>
          </div>
          <button
            className="new-connection"
            onClick={() => setConnectionDialog(null)}
          >
            <Plus size={16} />
            {t("新建连接")}
            <span>⌘ N</span>
          </button>
          <div className="connection-tree">
            {connections
              .filter(
                (c) =>
                  c.id === activeId ||
                  c.name.toLowerCase().includes(search.toLowerCase()) ||
                  !search,
              )
              .map((c) => (
                <div key={c.id} className="connection-group">
                  <div
                    className={`connection-item ${c.id === activeId ? "current" : ""}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContext({
                        kind: "connection",
                        connection: c,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    <button
                      className="connection-name"
                      onClick={() => void activate(c)}
                    >
                      {loadingConnection === c.id ? (
                        <Loader2 size={13} className="spin" />
                      ) : c.id === activeId ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                      <EngineIcon engine={c.engine} size={24} />
                      <strong>{c.name}</strong>
                    </button>
                    <span
                      className={`connection-dot ${c.connected ? "online" : ""}`}
                    />
                    {c.id !== "demo" && (
                      <button
                        className="icon-button connection-edit"
                        onClick={() => setConnectionDialog(c)}
                        title={t("编辑连接")}
                      >
                        <Ellipsis size={14} />
                      </button>
                    )}
                  </div>
                  {c.id === activeId && c.connected && (
                    <div className="database-tree">
                      {databaseNames.map((database) => (
                        <div className="database-node" key={database}>
                          <button
                            className={`database-name ${database === activeDatabase ? "selected" : ""}`}
                            onClick={
                              ["mysql", "postgres"].includes(c.engine)
                                ? () => void selectDatabase(database)
                                : undefined
                            }
                            disabled={!!loadingConnection || busy || queryBusy}
                            title={database || t("默认数据库")}
                            aria-expanded={database === activeDatabase}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContext({
                                kind: "database",
                                connection: { ...c, database },
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                          >
                            {database === activeDatabase ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                            <Database size={14} />
                            <span className="database-label">
                              {database || t("默认数据库")}
                            </span>
                            {database === activeDatabase && (
                              <span className="tree-count">
                                {objects.length}
                              </span>
                            )}
                          </button>
                          {database === activeDatabase && (
                            <>
                              <div className="object-group-label">
                                <ChevronDown size={12} />
                                <FolderClosed size={13} />
                                {c.engine === "mongodb"
                                  ? t("集合")
                                  : c.engine === "redis"
                                    ? t("键")
                                    : t("数据表")}
                                <span>{tables.length}</span>
                              </div>
                              {tables.map((o) => (
                                <button
                                  className={`object-item ${objectKey(o) === route ? "active" : ""}`}
                                  key={objectKey(o)}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContext({
                                      kind: "object",
                                      connection: { ...c, database },
                                      object: o,
                                      x: e.clientX,
                                      y: e.clientY,
                                    });
                                  }}
                                  onClick={() => openObject(o)}
                                >
                                  {o.type === "key" ? (
                                    <KeyRound size={14} />
                                  ) : o.type === "collection" ? (
                                    <Braces size={14} />
                                  ) : (
                                    <Table2 size={14} />
                                  )}
                                  <span>{o.name}</span>
                                  {c.engine === "postgres" &&
                                    o.schema &&
                                    o.schema !== "public" && (
                                      <small>{o.schema}</small>
                                    )}
                                  {objectKey(o) === route && (
                                    <span className="object-active-dot" />
                                  )}
                                </button>
                              ))}
                              {!!views.length && (
                                <>
                                  <div className="object-group-label view-label">
                                    <ChevronDown size={12} />
                                    <Layers size={13} />
                                    {t("视图")}
                                    <span>{views.length}</span>
                                  </div>
                                  {views.map((o) => (
                                    <button
                                      className={`object-item ${objectKey(o) === route ? "active" : ""}`}
                                      key={objectKey(o)}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        setContext({
                                          kind: "object",
                                          connection: { ...c, database },
                                          object: o,
                                          x: e.clientX,
                                          y: e.clientY,
                                        });
                                      }}
                                      onClick={() => openObject(o)}
                                    >
                                      <LayoutGrid size={14} />
                                      <span>{o.name}</span>
                                    </button>
                                  ))}
                                </>
                              )}
                              {!objects.length && (
                                <p className="tree-empty">
                                  {t("暂无数据库对象")}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      {c.engine === "mysql" && !activeDatabase && (
                        <p className="tree-empty">
                          {databaseNames.length
                            ? t("请选择数据库")
                            : t("暂无可访问的数据库")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
          <div className="sidebar-secondary">
            <div className="sidebar-section-label">{t("工作空间")}</div>
            <button
              className={route === "saved" ? "active" : ""}
              onClick={() => setRoute("saved")}
            >
              <BookOpen size={15} />
              {t("已保存查询")}
              <span>{saved.length}</span>
            </button>
            <button
              className={route === "history" ? "active" : ""}
              onClick={() => setRoute("history")}
            >
              <History size={15} />
              {t("查询历史")}
              <span>{history.length}</span>
            </button>
            <button
              className={route === "model" ? "active" : ""}
              onClick={() => setRoute("model")}
            >
              <GitBranch size={15} />
              {t("数据库关系图")}
            </button>
          </div>
          <div className="sidebar-bottom">
            <div className="demo-note">
              <span>
                <Sparkles size={14} />
                {activeId === "demo"
                  ? t("探索示例工作空间")
                  : t("数据库已就绪")}
              </span>
              <p>
                {activeId === "demo"
                  ? t(
                      "这是一个真实的本地 SQLite 数据库。试试查询、编辑或导出数据。",
                    )
                  : t("所有查询直接运行在你的数据库上。")}
              </p>
              <button
                onClick={() =>
                  activeId === "demo"
                    ? setConnectionDialog(null)
                    : setRoute("query")
                }
              >
                {activeId === "demo"
                  ? t("连接自己的数据库")
                  : t("打开查询编辑器")}
                <ArrowRight size={13} />
              </button>
            </div>
            <div className="sidebar-footer">
              <span className="online-dot" />
              <AppIcon size={18} />
              SQLStudio <span>v0.1.3</span>
            </div>
          </div>
        </aside>
        <main className="main-workspace">
          <div className="workspace-toolbar">
            <div className="breadcrumbs">
              <Database size={15} />
              <span>{connection?.name ?? t("工作空间")}</span>
              <ChevronRight size={13} />
              <strong>{connection?.database || t("数据库")}</strong>
              {connection && (
                <span className={`environment-label ${connection.environment}`}>
                  {connection.environment === "local"
                    ? "LOCAL"
                    : connection.environment === "production"
                      ? "PRODUCTION"
                      : "DEV"}
                </span>
              )}
            </div>
            <div className="workspace-actions">
              <button
                className="button text"
                onClick={() => setRoute("query")}
                disabled={!connected}
              >
                <Plus size={15} />
                {t("新建查询")}
              </button>
              <span className="toolbar-divider" />
              <button
                className="icon-button"
                title={t("刷新数据库")}
                onClick={() => void refreshObjects()}
                disabled={!connected}
              >
                <RefreshCw size={15} />
              </button>
              <button
                className="icon-button"
                title={showInspector ? t("隐藏详情") : t("显示详情")}
                onClick={() => setShowInspector((v) => !v)}
              >
                <PanelRightClose size={16} />
              </button>
            </div>
          </div>
          <div className="workspace-tabs">
            <button
              className={`workspace-tab object-tab ${["objects", "views"].includes(route) ? "active" : ""}`}
              onClick={() => setRoute("objects")}
            >
              {t("对象")}
            </button>
            {tabs.map((o) => (
              <button
                className={`workspace-tab ${objectKey(o) === route ? "active" : ""}`}
                key={objectKey(o)}
                onClick={() => {
                  resetTable();
                  setRoute(objectKey(o));
                }}
              >
                <Table2 size={14} />
                <span>{o.name}</span>
                <span
                  className="tab-close"
                  role="button"
                  aria-label={t("关闭 {0}", [o.name])}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(o);
                  }}
                >
                  <X size={12} />
                </span>
              </button>
            ))}
            {queryOpened && (
              <button
                className={`workspace-tab ${route === "query" ? "active" : ""}`}
                onClick={() => setRoute("query")}
              >
                <FileCode2 size={14} />
                <span>{t("查询 1")}</span>
                <span
                  className="tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={t("关闭 查询 1")}
                  title={t("关闭查询")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeQueryTab();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      closeQueryTab();
                    }
                  }}
                >
                  <X size={12} />
                </span>
              </button>
            )}
            {["model", "history", "saved", "structure", "sync"].includes(
              route,
            ) && (
              <button className="workspace-tab active">
                <span>{currentName}</span>
                <span
                  className="tab-close"
                  onClick={() =>
                    setRoute(
                      tabs[0]
                        ? objectKey(tabs[0])
                        : queryOpened
                          ? "query"
                          : "objects",
                    )
                  }
                >
                  <X size={12} />
                </span>
              </button>
            )}
            <button
              className="tab-add"
              title={t("新建查询")}
              onClick={() => setRoute("query")}
            >
              <Plus size={15} />
            </button>
            <div className="tabs-spacer" />
            <span className="engine-label">
              {connection && (
                <EngineIcon engine={connection.engine} size={17} />
              )}{" "}
              {engines.find((e) => e.id === connection?.engine)?.name}
            </span>
          </div>
          <div className="workspace-content">
            {!connected ? (
              <div className="disconnected-state">
                <div className="hero-db">
                  <Database size={34} />
                </div>
                <span className="eyebrow">YOUR DATA, IN FOCUS</span>
                <h1>
                  {loadingConnection
                    ? t("正在建立连接…")
                    : t("你的数据库，井然有序。")}
                </h1>
                <p>
                  {t("连接关系型、文档型与键值数据库，")}
                  <br />
                  {t("在一个工作空间中探索数据、编写查询、管理结构。")}
                </p>
                {loadingConnection ? (
                  <Loader2 size={23} className="spin" />
                ) : (
                  <button
                    className="button primary"
                    onClick={() =>
                      connection
                        ? void activate(connection)
                        : setConnectionDialog(null)
                    }
                  >
                    <Plus size={16} />
                    {connection ? t("连接数据库") : t("创建第一个连接")}
                  </button>
                )}
                <div className="supported-engines">
                  {engines.map((e) => (
                    <span key={e.id}>
                      <EngineIcon engine={e.id} size={26} />
                      {e.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : connection?.engine === "mysql" &&
              !activeDatabase &&
              ["objects", "views", "model", "structure", "sync"].includes(
                route,
              ) ? (
              <div className="disconnected-state">
                <div className="hero-db">
                  <Database size={34} />
                </div>
                <h1>{t("请选择数据库")}</h1>
                <p>
                  {databaseNames.length
                    ? t("在左侧选择数据库，查看其中的数据表和视图。")
                    : t("暂无可访问的数据库")}
                </p>
              </div>
            ) : ["objects", "views"].includes(route) && connection ? (
              <ObjectBrowser
                connection={connection}
                objects={objects}
                views={route === "views"}
                onOpen={openObject}
                onDesign={(o) => {
                  openObject(o);
                  setView("structure");
                }}
                onNew={() => {
                  setQueryText(
                    connection.engine === "mysql"
                      ? "CREATE TABLE new_table (\n  id BIGINT PRIMARY KEY AUTO_INCREMENT,\n  name VARCHAR(255) NOT NULL\n);"
                      : connection.engine === "postgres"
                        ? "CREATE TABLE new_table (\n  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n  name TEXT NOT NULL\n);"
                        : "CREATE TABLE new_table (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL\n);",
                  );
                  setRoute("query");
                }}
                onRefresh={() => void refreshObjects()}
                inspector={showInspector}
              />
            ) : object ? (
              <>
                <div className="object-heading">
                  <div className="object-heading-title">
                    <div className="object-title-icon">
                      <Table2 size={21} />
                    </div>
                    <div>
                      <h1>
                        {object.name}
                        <span>
                          {object.type === "view"
                            ? t("视图")
                            : object.type === "collection"
                              ? t("集合")
                              : object.type === "key"
                                ? t("键")
                                : t("数据表")}
                        </span>
                      </h1>
                      <p>
                        {connection?.database}
                        {object.schema && ` / ${object.schema}`}
                        <span>·</span>
                        {data.total.toLocaleString(language)} {t("条记录")}
                        <span>·</span>
                        {t("{0} 个字段", [info.columns.length])}
                      </p>
                    </div>
                  </div>
                  <div className="object-heading-actions">
                    <span className="live-label">
                      <span className="online-dot" />
                      {t("实时连接")}
                    </span>
                    <button
                      className="button"
                      onClick={() => {
                        const quoted =
                          connection?.engine === "mysql"
                            ? `\`${object.name.replaceAll("`", "``")}\``
                            : `"${object.name.replaceAll('"', '""')}"`;
                        setQueryText(
                          connection?.engine === "mongodb"
                            ? JSON.stringify(
                                {
                                  collection: object.name,
                                  operation: "find",
                                  filter: {},
                                  limit: 100,
                                },
                                null,
                                2,
                              )
                            : connection?.engine === "redis"
                              ? `["GET",${JSON.stringify(object.name)}]`
                              : `SELECT * FROM ${object.schema ? `"${object.schema.replaceAll('"', '""')}".` : ""}${quoted}\nLIMIT 100;`,
                        );
                        setRoute("query");
                      }}
                    >
                      <Code2 size={14} />
                      {t("查询此表")}
                    </button>
                  </div>
                </div>
                <div className="object-view-tabs">
                  <button
                    className={view === "data" ? "active" : ""}
                    onClick={() => setView("data")}
                  >
                    <Table2 size={15} />
                    {t("数据")}
                  </button>
                  <button
                    className={view === "structure" ? "active" : ""}
                    onClick={() => setView("structure")}
                  >
                    <Layers size={15} />
                    {t("结构")}
                    <span>{info.columns.length}</span>
                  </button>
                  <button
                    className={view === "relations" ? "active" : ""}
                    onClick={() => setView("relations")}
                  >
                    <GitBranch size={15} />
                    {t("关系")}
                  </button>
                  <div className="view-tabs-spacer" />
                  <span className="grid-hint">
                    {writable && hasPrimary
                      ? t("双击单元格编辑数据")
                      : t("浏览数据库对象")}
                  </span>
                </div>
                {view === "data" ? (
                  <>
                    <div className="data-toolbar">
                      <div className="filter-input">
                        <Search size={14} />
                        <input
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setAppliedFilter(filter);
                              setPage(1);
                            }
                          }}
                          placeholder={
                            connection?.engine === "mongodb"
                              ? t('JSON 筛选，例如 {"status":"active"}')
                              : t("筛选数据…")
                          }
                        />
                        {appliedFilter && (
                          <button
                            className="icon-button"
                            title={t("清除筛选")}
                            onClick={() => {
                              setFilter("");
                              setAppliedFilter("");
                              setPage(1);
                            }}
                          >
                            <X size={12} />
                          </button>
                        )}
                        <button
                          className="filter-apply"
                          onClick={() => {
                            setAppliedFilter(filter);
                            setPage(1);
                          }}
                        >
                          {t("筛选")}
                          <SlidersHorizontal size={12} />
                        </button>
                      </div>
                      {connection &&
                        ["sqlite", "mysql", "postgres"].includes(
                          connection.engine,
                        ) && (
                          <button
                            className={`button condition-toggle ${appliedConditions ? "has-conditions" : ""}`}
                            aria-expanded={showConditions}
                            onClick={() => setShowConditions((show) => !show)}
                          >
                            <SlidersHorizontal size={13} />
                            {t("条件筛选")}
                            {appliedConditions
                              ? ` (${appliedConditions.conditions.length})`
                              : ""}
                          </button>
                        )}
                      <div className="data-toolbar-actions">
                        {selected.length > 0 && (
                          <>
                            <span className="selection-label">
                              {t("已选 {0} 行", [selected.length])}
                            </span>
                            {writable && hasPrimary && (
                              <button
                                className="button text danger-text"
                                onClick={deleteRows}
                              >
                                <Trash2 size={14} />
                                {t("删除")}
                              </button>
                            )}
                          </>
                        )}
                        {writable && (
                          <button className="button text" onClick={insertRow}>
                            <Plus size={15} />
                            {t("添加记录")}
                          </button>
                        )}
                        <button
                          className="icon-button"
                          title={t("刷新数据")}
                          onClick={() => void loadTable()}
                        >
                          <RefreshCw size={14} className={busy ? "spin" : ""} />
                        </button>
                        <span className="toolbar-divider" />
                        {writable && (
                          <button
                            className="button text"
                            onClick={() => importRef.current?.click()}
                          >
                            <ArrowUpFromLine size={14} />
                            {t("导入")}
                          </button>
                        )}
                        <div className="dropdown-container">
                          <button
                            className="button text"
                            onClick={() => setExportMenu((v) => !v)}
                          >
                            <ArrowDownToLine size={14} />
                            {t("导出")}
                            <ChevronDown size={11} />
                          </button>
                          {exportMenu && (
                            <div className="dropdown">
                              <span>
                                {t("导出当前页 ·")} {data.rows.length} {t("行")}
                              </span>
                              <button onClick={() => exportResult("csv")}>
                                {t("CSV 表格")}
                              </button>
                              <button onClick={() => exportResult("json")}>
                                {t("JSON 数据")}
                              </button>
                              {connection?.engine === "sqlite" && (
                                <button
                                  onClick={() => {
                                    setExportMenu(false);
                                    void backup();
                                  }}
                                >
                                  {t("SQLite 完整备份")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {connection &&
                      ["sqlite", "mysql", "postgres"].includes(
                        connection.engine,
                      ) && (
                        <TableFilterBuilder
                          key={`${activeId}/${objectKey(object)}`}
                          columns={info.columns}
                          engine={connection.engine}
                          value={appliedConditions}
                          expanded={showConditions}
                          busy={busy}
                          onApply={(conditions) => {
                            setAppliedConditions(conditions);
                            setPage(1);
                          }}
                        />
                      )}
                    <div className="table-with-inspector">
                      <div className="table-area">
                        <DataGrid
                          result={data}
                          columns={info.columns}
                          selected={selected}
                          onSelect={setSelected}
                          onEdit={editRow}
                          sort={sort}
                          direction={direction}
                          onSort={(column) => {
                            setSort(column);
                            setDirection(
                              sort === column && direction === "asc"
                                ? "desc"
                                : "asc",
                            );
                            setPage(1);
                          }}
                          busy={busy}
                        />
                        <div className="table-pagination">
                          <div>
                            <span className="online-dot" />
                            {busy
                              ? t("正在读取…")
                              : t("{0}–{1} / {2} 条记录", [
                                  data.total
                                    ? (
                                        (page - 1) * pageSize +
                                        1
                                      ).toLocaleString(language)
                                    : 0,
                                  Math.min(
                                    page * pageSize,
                                    data.total,
                                  ).toLocaleString(language),
                                  data.total.toLocaleString(language),
                                ])}
                            <span className="pagination-time">
                              {data.elapsedMs.toFixed(1)} ms
                            </span>
                          </div>
                          <div className="pagination-actions">
                            <span>{t("每页")}</span>
                            <select
                              aria-label={t("每页记录数")}
                              value={pageSize}
                              onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setPage(1);
                              }}
                            >
                              <option>25</option>
                              <option>50</option>
                              <option>100</option>
                              <option>200</option>
                            </select>
                            <button
                              aria-label={t("第一页")}
                              className="icon-button"
                              disabled={page === 1}
                              onClick={() => setPage(1)}
                            >
                              <ChevronsLeft size={15} />
                            </button>
                            <button
                              aria-label={t("上一页")}
                              className="icon-button"
                              disabled={page === 1}
                              onClick={() => setPage((p) => p - 1)}
                            >
                              <ChevronLeft size={15} />
                            </button>
                            <span className="page-indicator">
                              {page}
                              <span>
                                /{" "}
                                {Math.max(1, Math.ceil(data.total / pageSize))}
                              </span>
                            </span>
                            <button
                              aria-label={t("下一页")}
                              className="icon-button"
                              disabled={page * pageSize >= data.total}
                              onClick={() => setPage((p) => p + 1)}
                            >
                              <ChevronRight size={15} />
                            </button>
                            <button
                              aria-label={t("最后一页")}
                              className="icon-button"
                              disabled={page * pageSize >= data.total}
                              onClick={() =>
                                setPage(
                                  Math.max(1, Math.ceil(data.total / pageSize)),
                                )
                              }
                            >
                              <ChevronsRight size={15} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {showInspector && (
                        <aside className="inspector">
                          <div className="inspector-heading">
                            <Info size={14} />
                            <span>{t("对象详情")}</span>
                            <button
                              className="icon-button"
                              onClick={() => setShowInspector(false)}
                              aria-label={t("隐藏对象详情")}
                            >
                              <X size={13} />
                            </button>
                          </div>
                          <div className="inspector-visual">
                            <div className="table-visual">
                              <Table2 size={28} />
                            </div>
                            <strong>{object.name}</strong>
                            <span>{connection?.database}</span>
                          </div>
                          <div className="inspector-section">
                            <h4>{t("概览")}</h4>
                            <dl>
                              <dt>{t("数据库类型")}</dt>
                              <dd>
                                {
                                  engines.find(
                                    (e) => e.id === connection?.engine,
                                  )?.name
                                }
                              </dd>
                              <dt>{t("记录数")}</dt>
                              <dd>{data.total.toLocaleString(language)}</dd>
                              <dt>{t("字段数")}</dt>
                              <dd>{info.columns.length}</dd>
                              <dt>{t("主键")}</dt>
                              <dd className="key-color">
                                {info.columns
                                  .filter((c) => c.primaryKey)
                                  .map((c) => c.name)
                                  .join(", ") || "—"}
                              </dd>
                              <dt>{t("连接状态")}</dt>
                              <dd className="green-text">
                                <span className="online-dot" />
                                {t("已连接")}
                              </dd>
                            </dl>
                          </div>
                          <div className="inspector-section fields-section">
                            <h4>
                              {t("字段")}
                              <span>{info.columns.length}</span>
                            </h4>
                            {info.columns.map((c) => (
                              <div className="inspector-field" key={c.name}>
                                <span
                                  className={c.primaryKey ? "key-color" : ""}
                                >
                                  {columnIcon(c)}
                                </span>
                                <strong>{c.name}</strong>
                                <code>
                                  {c.type.split("(")[0].toLowerCase() || "any"}
                                </code>
                              </div>
                            ))}
                          </div>
                          <div className="inspector-tip">
                            <span>
                              <Info size={14} />
                              {t("小提示")}
                            </span>
                            <p>
                              {t("在列标题上点击可排序。")}
                              <br />
                              {writable && hasPrimary
                                ? t("双击数据单元格，编辑并保存记录。")
                                : t("在查询编辑器中执行更多操作。")}
                            </p>
                          </div>
                        </aside>
                      )}
                    </div>
                  </>
                ) : view === "structure" ? (
                  <Structure info={info} />
                ) : (
                  <div className="object-relations">
                    <div className="section-caption">
                      <h3>
                        {object.name} {t("的外键关系")}
                      </h3>
                    </div>
                    {info.foreignKeys.length ? (
                      info.foreignKeys.map((f) => (
                        <div className="foreign-key-card" key={f.column}>
                          <div>
                            <Table2 size={18} />
                            <strong>{object.name}</strong>
                            <code>{f.column}</code>
                          </div>
                          <div className="relationship-line">
                            <span>{t("多对一")}</span>
                            <ArrowRight size={19} />
                          </div>
                          <button
                            onClick={() => {
                              const target = objects.find(
                                (o) => o.name === f.table,
                              );
                              if (target) openObject(target);
                            }}
                          >
                            <Table2 size={18} />
                            <strong>{f.table}</strong>
                            <code>{f.foreignColumn}</code>
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="relation-empty">
                        <GitBranch size={31} />
                        <h3>{t("这个对象没有外键关系")}</h3>
                        <p>{t("数据库关系图可以查看所有表的关联。")}</p>
                      </div>
                    )}
                    <button
                      className="button"
                      onClick={() => setRoute("model")}
                    >
                      <GitBranch size={15} />
                      {t("查看完整数据库关系图")}
                    </button>
                  </div>
                )}
              </>
            ) : route === "query" ? (
              <div className="query-workspace">
                <div className="query-toolbar">
                  <div className="query-context">
                    <FileCode2 size={16} />
                    <strong>{t("查询 1")}</strong>
                    <span className="tag blue">
                      {connection?.engine === "mongodb"
                        ? "JSON"
                        : connection?.engine === "redis"
                          ? "COMMAND"
                          : "SQL"}
                    </span>
                  </div>
                  <div>
                    <button
                      className="button text"
                      onClick={() => {
                        setModalText(t("未命名查询"));
                        setModalError("");
                        setModal({ kind: "save" });
                      }}
                    >
                      <BookOpen size={14} />
                      {t("保存查询")}
                    </button>
                    <span className="toolbar-divider" />
                    <button
                      className="button primary run-button"
                      onClick={requestQuery}
                      disabled={queryBusy}
                    >
                      {queryBusy ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Play size={13} fill="currentColor" />
                      )}
                      {queryBusy ? t("执行中") : t("运行")}
                      <kbd>⌘ ↵</kbd>
                    </button>
                  </div>
                </div>
                <div className="query-editor">
                  <CodeMirror
                    value={queryText}
                    height="100%"
                    extensions={[
                      connection?.engine === "mongodb"
                        ? json()
                        : sqlLanguage({
                            dialect:
                              connection?.engine === "mysql"
                                ? MySQL
                                : connection?.engine === "postgres"
                                  ? PostgreSQL
                                  : SQLite,
                            schema: Object.fromEntries(
                              objects.map((o) => [
                                o.name,
                                schemas[o.name]?.columns.map((c) => c.name) ??
                                  [],
                              ]),
                            ),
                          }),
                      editorTheme,
                    ]}
                    onChange={setQueryText}
                    onCreateEditor={(view) => {
                      editorRef.current = view;
                    }}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: true,
                      highlightActiveLine: true,
                      autocompletion: true,
                    }}
                  />
                </div>
                <div className="editor-status">
                  <span>
                    <ShieldCheck size={12} />
                    {connection?.name} · {connection?.database}
                  </span>
                  <span>
                    UTF-8<span>·</span>
                    {connection?.engine === "redis"
                      ? t("Redis 命令 / JSON 参数数组")
                      : connection?.engine === "mongodb"
                        ? t("JSON 数据库命令")
                        : t("选中语句可单独运行")}
                  </span>
                </div>
                <div className="result-toolbar">
                  <div>
                    <Table2 size={14} />
                    <strong>{t("查询结果")}</strong>
                    <span className="count-pill">
                      {queryResult.rows.length}
                    </span>
                    {queryResult.elapsedMs > 0 && (
                      <span className="query-time">
                        <Check size={12} />
                        {queryResult.elapsedMs.toFixed(1)} ms
                      </span>
                    )}
                  </div>
                  <div>
                    {queryResult.truncated && (
                      <span className="amber-text">
                        {t("已截断到 1,000 行")}
                      </span>
                    )}
                    <button
                      className="button text"
                      onClick={() => exportResult("csv")}
                      disabled={!queryResult.columns.length}
                    >
                      <Download size={14} />
                      {t("导出结果")}
                    </button>
                  </div>
                </div>
                {queryError ? (
                  <div className="query-error">
                    <div>
                      <X size={18} />
                      <strong>{t("查询执行失败")}</strong>
                    </div>
                    <pre>{t(queryError)}</pre>
                    <p>{t("检查语法、对象名称与数据库权限后重试。")}</p>
                  </div>
                ) : (
                  <DataGrid
                    result={queryResult}
                    selected={querySelected}
                    onSelect={setQuerySelected}
                  />
                )}
              </div>
            ) : route === "structure" || route === "sync" ? (
              <CompareWorkspace
                mode={route === "structure" ? "structure" : "data"}
                connections={connections}
                activeId={activeId}
                activeDatabase={activeDatabase}
                initialObject={compareObject}
                onQuery={(scope, text) => {
                  const target = connections.find(
                    (c) => c.id === scope.connectionId,
                  );
                  if (!target) return;
                  void (async () => {
                    if (target.id !== activeId) await activate(target);
                    if (["mysql", "postgres"].includes(target.engine)) {
                      await api.selectDatabase(target.id, scope.database);
                      resetDatabaseWorkspace();
                      const catalog = await api.databases(target.id);
                      setActiveDatabase(catalog.selected);
                      setDatabaseNames(catalog.names);
                      setObjects(await api.objects(target.id));
                    }
                    setQueryText(text);
                    setRoute("query");
                  })().catch((e) => notify(e.message, true));
                }}
                onRefresh={() => void refreshConnections()}
              />
            ) : route === "model" ? (
              <div className="model-workspace">
                <div className="model-toolbar">
                  <div>
                    <GitBranch size={17} />
                    <strong>{t("数据库关系图")}</strong>
                    <span className="tag">
                      {t("{0} 个表", [
                        objects.filter((o) => o.type === "table").length,
                      ])}
                    </span>
                  </div>
                  <button
                    className="button text"
                    onClick={() => {
                      setRoute("query");
                      setTimeout(() => setRoute("model"), 0);
                    }}
                  >
                    <RefreshCw size={14} />
                    {t("重新加载")}
                  </button>
                </div>
                {busy ? (
                  <div className="loading-view">
                    <Loader2 className="spin" size={25} />
                    {t("正在读取表结构…")}
                  </div>
                ) : objects.some((o) => o.type === "table") ? (
                  <RelationGraph
                    objects={objects}
                    schemas={schemas}
                    onOpen={openObject}
                  />
                ) : (
                  <div className="relation-empty">
                    <GitBranch size={30} />
                    <h3>{t("关系图支持关系型数据库")}</h3>
                    <p>
                      {t("连接 MySQL、PostgreSQL 或 SQLite 后查看表关系。")}
                    </p>
                  </div>
                )}
              </div>
            ) : route === "history" || route === "saved" ? (
              <div className="library-view">
                <div className="library-heading">
                  <div>
                    <span className="eyebrow">YOUR WORKSPACE</span>
                    <h1>
                      {route === "history"
                        ? t("每一次探索，都有迹可循。")
                        : t("把好用的查询，留在手边。")}
                    </h1>
                    <p>
                      {route === "history"
                        ? t("最近 100 次执行记录，保存在当前设备。")
                        : t("保存的查询可随时重新编辑和执行。")}
                    </p>
                  </div>
                  {route === "history" && history.length > 0 && (
                    <button
                      className="button"
                      onClick={() =>
                        setModal({
                          kind: "confirm",
                          title: t("清空查询历史？"),
                          description: t("将删除此设备中的所有查询执行记录。"),
                          danger: true,
                          action: async () => {
                            setHistory([]);
                          },
                        })
                      }
                    >
                      <Trash2 size={14} />
                      {t("清空历史")}
                    </button>
                  )}
                  <button
                    className="button primary"
                    onClick={() => setRoute("query")}
                  >
                    <Plus size={14} />
                    {t("新建查询")}
                  </button>
                </div>
                <div className="query-library">
                  {(route === "history" ? history : saved).map((item) => (
                    <article className="library-card" key={item.id}>
                      <div className="library-card-heading">
                        <span className="library-icon">
                          <FileCode2 size={17} />
                        </span>
                        <strong>
                          {"name" in item ? item.name : item.connectionName}
                        </strong>
                        {"success" in item && (
                          <span
                            className={`tag ${item.success ? "green" : "red"}`}
                          >
                            {item.success ? t("执行成功") : t("执行失败")}
                          </span>
                        )}
                        <time>
                          {new Date(
                            "timestamp" in item
                              ? item.timestamp
                              : item.updatedAt,
                          ).toLocaleString(language)}
                        </time>
                      </div>
                      <pre>{"sql" in item ? item.sql : item.text}</pre>
                      <div className="library-card-footer">
                        <span>
                          {"elapsedMs" in item
                            ? t("{0} ms · {1} 行", [
                                item.elapsedMs.toFixed(1),
                                item.rowCount,
                              ])
                            : "SQL / Command"}
                          {"error" in item &&
                            item.error &&
                            ` · ${t(item.error)}`}
                        </span>
                        <button
                          className="button text"
                          onClick={() => {
                            const target = connections.find(
                              (c) => c.id === item.connectionId,
                            );
                            const text = "sql" in item ? item.sql : item.text;
                            if (target && target.id !== activeId) {
                              void activate(target).then(() => {
                                setQueryText(text);
                                setRoute("query");
                              });
                            } else {
                              setQueryText(text);
                              setRoute("query");
                            }
                          }}
                        >
                          {t("在编辑器打开")}
                          <ArrowRight size={13} />
                        </button>
                        {route === "saved" && (
                          <button
                            className="icon-button"
                            title={t("删除已保存查询")}
                            onClick={() =>
                              setSaved((s) => s.filter((q) => q.id !== item.id))
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                  {!(route === "history" ? history : saved).length && (
                    <div className="library-empty">
                      <BookOpen size={34} />
                      <h3>
                        {route === "history"
                          ? t("还没有查询记录")
                          : t("还没有保存的查询")}
                      </h3>
                      <p>{t("打开查询编辑器，开始你的第一次探索。")}</p>
                      <button
                        className="button"
                        onClick={() => setRoute("query")}
                      >
                        {t("打开编辑器")}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="loading-view">
                <Loader2 className="spin" size={25} />
                {t("正在加载工作空间…")}
              </div>
            )}
          </div>
          <footer className="statusbar">
            <div>
              <span className={`connection-dot ${connected ? "online" : ""}`} />
              <strong>{connected ? t("已连接") : t("未连接")}</strong>
              <span className="status-separator" />{" "}
              {connection &&
                `${engines.find((e) => e.id === connection.engine)?.name} ${version}`}
              <span className="status-separator" />
              <span>{connection?.host || t("本地数据库")}</span>
            </div>
            <div>
              {connection?.ssl && (
                <span>
                  <ShieldCheck size={12} />
                  TLS
                </span>
              )}
              <span>
                <Activity size={12} />
                {busy || queryBusy ? t("执行中") : t("就绪")}
              </span>
              <span>UTF-8</span>
              <span className="status-separator" />
              <span>SQLStudio 0.1.3</span>
            </div>
          </footer>
        </main>
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={sqlImportRef}
        type="file"
        accept=".sql,text/plain,application/sql"
        hidden
        onChange={(event) => {
          void importSqlFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {sqlFile && connection && (
        <SqlImportDialog
          connection={sqlFile.target}
          file={sqlFile}
          onClose={() => setSqlFile(null)}
          onImported={(statements) => {
            setSqlFile(null);
            void refreshObjects();
            notify(t("SQL 导入完成 · {0} 条语句", [statements]));
          }}
        />
      )}
      {connectionDialog !== false && (
        <ConnectionDialog
          initial={connectionDialog ?? undefined}
          onClose={() => setConnectionDialog(false)}
          onSaved={(c) => {
            setConnectionDialog(false);
            void refreshConnections().then(() => activate(c));
            notify(t("连接已保存"));
          }}
        />
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!modalBusy) setModal(null);
          }}
        >
          <section
            className={`modal ${modal.kind === "settings" ? "settings-modal" : "action-modal"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div className="modal-icon">
                {modal.kind === "confirm" && modal.danger ? (
                  <Trash2 size={20} />
                ) : modal.kind === "settings" ? (
                  <Settings2 size={20} />
                ) : (
                  <FileCode2 size={20} />
                )}
              </div>
              <div>
                <h2 id="action-modal-title">
                  {modal.kind === "confirm"
                    ? t(modal.title)
                    : modal.kind === "row"
                      ? modal.mode === "insert"
                        ? t("添加记录")
                        : t("编辑记录")
                      : modal.kind === "save"
                        ? t("保存查询")
                        : modal.kind === "rename"
                          ? t("重命名对象")
                          : t("系统设置")}
                </h2>
                {modal.kind === "row" && (
                  <p>{t("以 JSON 编辑字段值 · null 表示数据库 NULL")}</p>
                )}
              </div>
              <button
                className="icon-button close"
                onClick={() => setModal(null)}
                disabled={modalBusy}
                aria-label={t("关闭")}
              >
                <X size={18} />
              </button>
            </div>
            {modal.kind === "confirm" ? (
              <p className="confirm-description">{t(modal.description)}</p>
            ) : modal.kind === "row" ? (
              <div className="row-editor">
                <div className="row-editor-meta">
                  <Database size={14} />
                  {connection?.name}
                  <ChevronRight size={12} />
                  {object?.name}
                </div>
                <CodeMirror
                  value={modalText}
                  height="300px"
                  extensions={[json(), editorTheme]}
                  onChange={setModalText}
                />
                <p>
                  {modal.mode === "edit"
                    ? t("主键保持原值；保存后立即写入数据库。")
                    : t("省略有默认值或自动生成的字段。保存后立即写入数据库。")}
                </p>
              </div>
            ) : modal.kind === "save" || modal.kind === "rename" ? (
              <label className="save-query-label">
                {modal.kind === "rename" ? t("新对象名称") : t("查询名称")}
                <input
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitModal();
                  }}
                />
              </label>
            ) : (
              <div className="settings-body">
                <div className="settings-brand">
                  <span className="brand-symbol app-brand-icon">
                    <AppIcon size={54} />
                  </span>
                  <div>
                    <h3>SQLStudio</h3>
                    <span>{t("跨平台数据库工作空间 · 0.1.0")}</span>
                  </div>
                </div>
                <div className="settings-language">
                  <label htmlFor="interface-language">{t("界面语言")}</label>
                  <select
                    id="interface-language"
                    aria-label={t("选择界面语言")}
                    value={language}
                    onChange={(event) =>
                      setLanguage(event.target.value === "en" ? "en" : "zh-CN")
                    }
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                  <p>{t("切换后立即生效，自动保存到此设备。")}</p>
                </div>
                <div className="settings-detail">
                  <strong>{t("运行模式")}</strong>
                  <span>
                    {window.desktop
                      ? t("Electron 桌面端")
                      : t("浏览器开发预览")}
                  </span>
                </div>
                <div className="settings-detail">
                  <strong>{t("连接存储")}</strong>
                  <span>
                    {window.desktop
                      ? t("系统凭据加密；系统不可用时不保存密码")
                      : t("浏览器预览不持久保存密码与 URI")}
                  </span>
                </div>
                <h4 className="settings-section-title">{t("键盘快捷键")}</h4>
                <div className="settings-detail">
                  <strong>{t("执行查询")}</strong>
                  <kbd>⌘ / Ctrl + Enter</kbd>
                </div>
                <div className="settings-detail">
                  <strong>{t("保存查询")}</strong>
                  <kbd>⌘ / Ctrl + S</kbd>
                </div>
                <div className="settings-detail">
                  <strong>{t("新建连接")}</strong>
                  <kbd>⌘ / Ctrl + N</kbd>
                </div>
                {activeId !== "demo" && connection && (
                  <div className="connection-settings-actions">
                    <button
                      className="button"
                      onClick={() => {
                        setModal(null);
                        setConnectionDialog(connection);
                      }}
                    >
                      {t("编辑当前连接")}
                    </button>
                    <button
                      className="button danger"
                      onClick={() =>
                        setModal({
                          kind: "confirm",
                          title: t("删除当前连接？"),
                          description: t(
                            "删除本地连接配置，不会删除数据库中的数据。",
                          ),
                          danger: true,
                          action: async () => {
                            await api.removeConnection(activeId);
                            const list = await refreshConnections();
                            await activate(list[0]);
                          },
                        })
                      }
                    >
                      {t("删除连接配置")}
                    </button>
                  </div>
                )}
                <button
                  className="button"
                  disabled={!connected}
                  onClick={async () => {
                    try {
                      await api.disconnect(activeId);
                      setObjects([]);
                      await refreshConnections();
                      setModal(null);
                      notify(t("数据库连接已关闭"));
                    } catch (e) {
                      notify((e as Error).message, true);
                    }
                  }}
                >
                  {t("断开当前连接")}
                </button>
              </div>
            )}
            {modalError && (
              <div className="form-message error">{t(modalError)}</div>
            )}
            {modal.kind !== "settings" && (
              <footer className="modal-footer">
                <button
                  className="button"
                  onClick={() => setModal(null)}
                  disabled={modalBusy}
                >
                  {t("取消")}
                </button>
                <button
                  className={`button ${modal.kind === "confirm" && modal.danger ? "danger" : "primary"}`}
                  onClick={() => void submitModal()}
                  disabled={modalBusy}
                >
                  {modalBusy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Check size={15} />
                  )}
                  {modal.kind === "row" || modal.kind === "save"
                    ? t("保存")
                    : t("确认")}
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
      {context && (
        <ContextMenu
          x={context.x}
          y={context.y}
          items={contextItems()}
          onClose={() => setContext(null)}
        />
      )}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`}>
          {toast.error ? <Info size={17} /> : <Check size={17} />}
          <span>{t(toast.text)}</span>
          <button onClick={() => setToast(null)} aria-label={t("关闭提示")}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
function HardDriveIcon() {
  return (
    <span className="tiny-drive">
      <Square size={11} />
    </span>
  );
}
