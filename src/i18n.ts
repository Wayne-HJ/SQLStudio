import { useSyncExternalStore } from "react";
import {
  languageStorageKey,
  normalizeLanguage,
  translate,
  type Language,
} from "../shared/localization";

function readLanguage(): Language {
  try {
    return normalizeLanguage(localStorage.getItem(languageStorageKey));
  } catch {
    return "zh-CN";
  }
}
let language = readLanguage();
const listeners = new Set<() => void>();
export const t = (message: string, values?: readonly unknown[]) =>
  translate(language, message, values);
export const getLanguage = () => language;
function updateDocument() {
  document.documentElement.lang = language;
  document.title = t("SQLStudio · 数据库工作空间");
}
updateDocument();
export function setLanguage(value: Language) {
  language = normalizeLanguage(value);
  try {
    localStorage.setItem(languageStorageKey, language);
  } catch {
    /* Language still works for this session. */
  }
  updateDocument();
  void window.desktop?.setLanguage(language).catch(() => {});
  listeners.forEach((listener) => listener());
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLanguage,
    getLanguage,
  );
}
window.addEventListener("storage", (event) => {
  if (event.key === languageStorageKey)
    setLanguage(normalizeLanguage(event.newValue));
});
