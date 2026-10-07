import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  Menu,
} from "electron";
import path from "node:path";
import { DatabaseService } from "../server/service.js";
import { ConnectionStore } from "../server/store.js";
import { createDispatcher, safeError } from "../server/rpc.js";
import { translate, type Language } from "../shared/localization.js";
let window: BrowserWindow | null = null;
let service: DatabaseService;
const development = process.env.SQLSTUDIO_DEV === "1";
const iconPath = () =>
  path.join(app.getAppPath(), development ? "public" : "dist", "app-icon.png");
let language: Language = "zh-CN";
const t = (message: string) => translate(language, message);
function updateMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "SQLStudio",
        submenu: [
          { role: "about", label: t("关于 SQLStudio") },
          { type: "separator" },
          { role: "quit", label: t("退出 SQLStudio") },
        ],
      },
      {
        label: t("编辑"),
        submenu: [
          { role: "undo", label: t("撤销") },
          { role: "redo", label: t("重做") },
          { type: "separator" },
          { role: "cut", label: t("剪切") },
          { role: "copy", label: t("复制") },
          { role: "paste", label: t("粘贴") },
          { role: "selectAll", label: t("全选") },
        ],
      },
      {
        label: t("查看"),
        submenu: [
          { role: "reload", label: t("重新加载") },
          { role: "toggleDevTools", label: t("开发者工具") },
          { role: "resetZoom", label: t("实际大小") },
          { role: "zoomIn", label: t("放大") },
          { role: "zoomOut", label: t("缩小") },
        ],
      },
    ]),
  );
}
async function createWindow() {
  const directory = app.getPath("userData");
  const codec = safeStorage.isEncryptionAvailable()
    ? {
        encrypt: (s: string) => safeStorage.encryptString(s).toString("base64"),
        decrypt: (s: string) =>
          safeStorage.decryptString(Buffer.from(s, "base64")),
      }
    : undefined;
  service = new DatabaseService(
    directory,
    new ConnectionStore(directory, codec),
  );
  const dispatch = createDispatcher(service);
  window = new BrowserWindow({
    width: 1510,
    height: 960,
    minWidth: 1000,
    minHeight: 680,
    title: "SQLStudio",
    icon: iconPath(),
    backgroundColor: "#f8f9fc",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 10 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const trusted = (event: Electron.IpcMainInvokeEvent) =>
    event.sender === window?.webContents &&
    event.senderFrame === window?.webContents.mainFrame;
  ipcMain.handle("database", async (event, method: string, args: unknown[]) => {
    if (!trusted(event)) throw new Error("来源不受信任");
    try {
      return { result: await dispatch(method, args) };
    } catch (error) {
      return { error: safeError(error, args) };
    }
  });
  ipcMain.handle("pick-file", async (event) => {
    if (!trusted(event)) throw new Error("来源不受信任");
    const result = await dialog.showOpenDialog(window!, {
      title: t("打开 SQLite 数据库"),
      properties: ["openFile"],
      filters: [
        { name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] },
        { name: t("全部文件"), extensions: ["*"] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("set-language", (event, value: unknown) => {
    if (!trusted(event)) throw new Error("来源不受信任");
    if (value !== "zh-CN" && value !== "en")
      throw new Error("参数格式不正确，请检查输入。");
    language = value;
    updateMenu();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  if (development) await window.loadURL("http://localhost:5173");
  else
    await window.loadFile(
      path.join(import.meta.dirname, "../../dist/index.html"),
    );
  window.on("closed", () => {
    window = null;
    ipcMain.removeHandler("database");
    ipcMain.removeHandler("pick-file");
    ipcMain.removeHandler("set-language");
  });
}
app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.setIcon(iconPath());
  app.setAboutPanelOptions({
    applicationName: "SQLStudio",
    applicationVersion: app.getVersion(),
    iconPath: iconPath(),
  });
  updateMenu();
  void createWindow();
  app.on("activate", () => {
    if (!window) void createWindow();
  });
});
app.on("window-all-closed", () => {
  void service?.shutdown();
  if (process.platform !== "darwin") app.quit();
});
let closing = false;
app.on("before-quit", (event) => {
  if (!closing && service) {
    event.preventDefault();
    closing = true;
    service.shutdown().finally(() => app.quit());
  }
});
