import {
  parseRowsPayload,
  parseRowsText,
  rowsText,
  type ClipboardRows,
} from "../shared/row-clipboard";

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");

export function rowClipboardContent(data: ClipboardRows) {
  return {
    text: rowsText(data),
    html: `<table data-sqlstudio-rows="${encodeURIComponent(JSON.stringify(data))}"><tbody>${data.rows
      .map(
        (row) =>
          `<tr>${data.columns
            .map((name) => {
              const value = row[name];
              const text =
                value == null
                  ? value === null
                    ? "NULL"
                    : "DEFAULT"
                  : typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value);
              return `<td>${escapeHtml(text)}</td>`;
            })
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`,
  };
}

export async function writeRowsClipboard(data: ClipboardRows) {
  const { text, html } = rowClipboardContent(data);
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some browser clipboard implementations only support plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}

export function readRowsContent(text: string, html: string, columns: string[]) {
  const payload = html
    ? new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("table[data-sqlstudio-rows]")
        ?.getAttribute("data-sqlstudio-rows")
    : null;
  return payload
    ? parseRowsPayload(decodeURIComponent(payload))
    : parseRowsText(text, columns);
}

export async function readRowsClipboard(columns: string[]) {
  if (navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      const item = items.find((entry) => entry.types.includes("text/plain"));
      if (item) {
        const text = await (await item.getType("text/plain")).text();
        const html = item.types.includes("text/html")
          ? await (await item.getType("text/html")).text()
          : "";
        return readRowsContent(text, html, columns);
      }
    } catch (error) {
      if ((error as Error).name !== "NotAllowedError") throw error;
    }
  }
  return parseRowsText(await navigator.clipboard.readText(), columns);
}
