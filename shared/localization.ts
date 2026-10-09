import { englishMessages } from "./messages.js";

export type Language = "zh-CN" | "en";
export const languageStorageKey = "sqlstudio.language";
export function normalizeLanguage(value: unknown): Language {
  return value === "en" ? "en" : "zh-CN";
}
const normalize = (text: string) => text.trim().replace(/\s+/g, " ");
const messages = new Map(Object.entries(englishMessages));
const reverse = new Map(
  Object.entries(englishMessages).map(([source, english]) => [
    normalize(english),
    source,
  ]),
);
const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function pattern(text: string) {
  // Templates made entirely of placeholders cannot identify a UI message.
  // In particular, "{0} {1}" would match any driver error containing a space.
  if (!normalize(text).replace(/\{\d+\}/g, "").trim()) return undefined;
  const parts = normalize(text).split(/(\{\d+\})/);
  const indices: number[] = [];
  const expression = parts
    .map((part) => {
      if (/^\{\d+\}$/.test(part)) {
        indices.push(Number(part.slice(1, -1)));
        return "([\\s\\S]*?)";
      }
      return escapeRegex(part);
    })
    .join("");
  return { regex: new RegExp(`^${expression}$`), indices };
}
// Native/backend errors arrive already formatted. Match only known UI messages.
const patterns = Object.entries(englishMessages)
  .filter(([source]) => /\{\d+\}/.test(source))
  .sort(([a], [b]) => b.length - a.length)
  .map(([source, english]) => ({
    source,
    sourcePattern: pattern(source),
    englishPattern: pattern(english),
  }));
const format = (text: string, values: readonly unknown[]) =>
  text.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? "") : token,
  );

/** Translate interface text only. Identifiers, SQL, connection names and row values stay untouched. */
export function translate(
  language: Language,
  message: string,
  values?: readonly unknown[],
): string {
  const key = normalize(message);
  if (values)
    return format(
      language === "en" ? (messages.get(key) ?? message) : message,
      values,
    );
  const source = messages.has(key) ? key : reverse.get(key);
  if (source) return language === "en" ? englishMessages[source] : source;
  for (const entry of patterns) {
    for (const candidate of [entry.sourcePattern, entry.englishPattern]) {
      if (!candidate) continue;
      const match = candidate.regex.exec(message.trim());
      if (!match) continue;
      const parameters: string[] = [];
      candidate.indices.forEach((index, i) => {
        parameters[index] = match[i + 1];
      });
      return format(
        language === "en" ? englishMessages[entry.source] : entry.source,
        parameters,
      );
    }
  }
  return message;
}
