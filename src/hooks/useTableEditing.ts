import { useRef, useState } from "react";
import type { Column, TablePage } from "../../shared/types";
import {
  cellDraft,
  draftValues,
  generatedColumn,
  rowKey,
  type CellDraft,
  type RowDraft,
} from "../../shared/table-editing";
import { t } from "../i18n";

export function useTableEditing({
  scope,
  data,
  columns,
  writable,
  update,
  insert,
  refresh,
  onError,
  onSaved,
}: {
  scope: string;
  data: TablePage;
  columns: Column[];
  writable: boolean;
  update: (
    key: Record<string, unknown>,
    values: Record<string, unknown>,
  ) => Promise<void>;
  insert: (values: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  onError: (error: string) => void;
  onSaved: (count: number) => void;
}) {
  const [workspaces, setWorkspaces] = useState<Record<string, RowDraft[]>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const drafts = workspaces[scope] ?? [];
  const newRows = drafts.filter((draft) => !draft.original);
  const identity = (row: Record<string, unknown>) =>
    JSON.stringify(rowKey(columns, row));
  const findDraft = (index: number) =>
    index < data.rows.length
      ? drafts.find(
          (draft) =>
            draft.original &&
            identity(draft.original) === identity(data.rows[index]),
        )
      : newRows[index - data.rows.length];
  const setDrafts = (
    change: (rows: RowDraft[]) => RowDraft[],
    target = scope,
  ) =>
    setWorkspaces((previous) => ({
      ...previous,
      [target]: change(previous[target] ?? []),
    }));
  const editable = (index: number, name: string) =>
    writable &&
    (index >= data.rows.length || columns.some((c) => c.primaryKey)) &&
    !!columns.find((c) => c.name === name) &&
    !generatedColumn(columns.find((c) => c.name === name)!);
  const change = (index: number, name: string, cell: CellDraft) => {
    if (!editable(index, name) || savingRef.current) return;
    const original = data.rows[index];
    const draft = findDraft(index) ?? {
      id: crypto.randomUUID(),
      original,
      cells: {},
    };
    const cells = { ...draft.cells, [name]: cell };
    if (
      original &&
      JSON.stringify(cell) === JSON.stringify(cellDraft(original[name]))
    )
      delete cells[name];
    setDrafts((previous) => {
      if (original && !Object.keys(cells).length)
        return previous.filter((row) => row.id !== draft.id);
      const next = { ...draft, cells };
      return previous.some((row) => row.id === draft.id)
        ? previous.map((row) => (row.id === draft.id ? next : row))
        : [...previous, next];
    });
  };
  const add = () => {
    if (!writable || savingRef.current) return;
    const draft: RowDraft = { id: crypto.randomUUID(), cells: {} };
    setDrafts((previous) => [...previous, draft]);
  };
  async function save() {
    if (!writable || !drafts.length || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let completed = 0;
    try {
      const writes = drafts.map((draft) => {
        try {
          return { draft, values: draftValues(draft, columns) };
        } catch (error) {
          // Identify the invalid field before performing any writes.
          for (const name of Object.keys(draft.cells)) {
            try {
              draftValues(
                { ...draft, cells: { [name]: draft.cells[name] } },
                columns,
              );
            } catch (fieldError) {
              throw new Error(t((fieldError as Error).message, [name]));
            }
          }
          throw error;
        }
      });
      for (const { draft, values } of writes) {
        if (draft.original)
          await update(rowKey(columns, draft.original), values);
        else await insert(values);
        completed++;
        // Remove successful inserts immediately so retrying cannot insert them twice.
        setDrafts(
          (previous) => previous.filter((row) => row.id !== draft.id),
          scope,
        );
      }
      onSaved(completed);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      if (completed && currentScope.current === scope) await refresh();
      savingRef.current = false;
      setSaving(false);
    }
  }
  return {
    pending: drafts.length,
    saving,
    add,
    save,
    cancel: () => {
      if (!savingRef.current) setDrafts(() => []);
    },
    result: { ...data, rows: [...data.rows, ...newRows.map(() => ({}))] },
    grid: {
      editable,
      cell: (index: number, name: string) =>
        findDraft(index)?.cells[name] ?? cellDraft(data.rows[index]?.[name]),
      change,
      changed: (index: number, name: string) => !!findDraft(index)?.cells[name],
      isNew: (index: number) => index >= data.rows.length,
      remove: (index: number) => {
        const draft = findDraft(index);
        if (draft && !savingRef.current)
          setDrafts((previous) =>
            previous.filter((row) => row.id !== draft.id),
          );
      },
    },
  };
}
