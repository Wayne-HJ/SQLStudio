import type { Api } from "../shared/types";
declare global {
  interface Window {
    desktop?: {
      invoke(
        method: string,
        args: unknown[],
      ): Promise<{ result?: unknown; error?: string }>;
      pickFile(): Promise<string | null>;
      setLanguage(language: "zh-CN" | "en"): Promise<void>;
      platform: string;
    };
  }
}
export const api = new Proxy({} as Api, {
  get:
    (_, method: string) =>
    async (...args: unknown[]) => {
      if (method === "pickFile") return window.desktop?.pickFile() ?? null;
      const response = window.desktop
        ? await window.desktop.invoke(method, args)
        : await fetch("/api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method, args }),
          }).then((r) => r.json());
      if (response.error) throw new Error(response.error);
      return response.result;
    },
});
