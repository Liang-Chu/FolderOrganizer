import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, FolderOpen, Database, ExternalLink, Download, Upload, RefreshCw } from "lucide-react";
import { open, save, message } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { useNavigate, useSearchParams } from "react-router";
import * as api from "../api";
import type { AppConfig, AppSettings, DbStats } from "../types";
import { formatBytes } from "../utils/format";

const LANGUAGES = [
  { code: "en", labelKey: "settings.langEn" },
  { code: "zh", labelKey: "settings.langZh" },
  { code: "fr", labelKey: "settings.langFr" },
];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [dbPath, setDbPath] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightSection, setHighlightSection] = useState<string | null>(null);

  // Handle highlight param from Data Explorer link
  useEffect(() => {
    const highlight = searchParams.get("highlight");
    if (highlight) {
      // Remove the param from URL so it doesn't persist
      setSearchParams({}, { replace: true });
      // Wait for render then scroll + highlight
      requestAnimationFrame(() => {
        const el = document.getElementById(highlight);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightSection(highlight);
          setTimeout(() => setHighlightSection(null), 3000);
        }
      });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    api.getConfig().then((cfg) => {
      setConfig(cfg);
      setSettings(cfg.settings);
    });
    api.getDbStats().then(setDbStats);
    api.getDbPath().then(setDbPath);
  }, []);

  const handleSave = async () => {
    if (!config || !settings) return;
    const newConfig = { ...config, settings };
    await api.saveConfig(newConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Restart watcher with new settings
    api.restartWatcher().catch(() => {});
  };

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    // Persisted automatically via localStorage by i18next-browser-languagedetector
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("settings.title")}</h2>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
        >
          <Save size={16} />
          {saved ? t("settings.saved") : t("settings.save")}
        </button>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
        {/* Language */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.language")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.languageDesc")}
            </p>
          </div>
          <select
            value={i18n.language?.substring(0, 2) || "en"}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {t(lang.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* Scan interval */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.scanInterval")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.scanIntervalDesc")}
            </p>
          </div>
          <input
            type="number"
            min={1}
            value={settings.scan_interval_minutes}
            onChange={(e) =>
              setSettings({
                ...settings,
                scan_interval_minutes: Math.max(1, parseInt(e.target.value) || 1),
              })
            }
            className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-right"
          />
        </div>

        {/* Start with OS */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.startWithOs")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.startWithOsDesc")}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.start_with_os}
              onChange={(e) =>
                setSettings({ ...settings, start_with_os: e.target.checked })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>

        {/* Minimize to tray */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.minimizeToTray")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.minimizeToTrayDesc")}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.minimize_to_tray}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  minimize_to_tray: e.target.checked,
                })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>

        {/* Notifications */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.notifications")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.notificationsDesc")}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifications_enabled}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notifications_enabled: e.target.checked,
                })
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>

        {/* Default sort root */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium">{t("settings.defaultSortRoot")}</p>
              <p className="text-xs text-zinc-500">
                {t("settings.defaultSortRootDesc")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.default_sort_root}
              onChange={(e) =>
                setSettings({ ...settings, default_sort_root: e.target.value })
              }
              placeholder="D:\sorted"
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={async () => {
                const startPath = (settings.default_sort_root || "D:\\sorted").replace(/[\\/]+$/, "");
                try { await api.ensureDir(startPath); } catch { /* ignore */ }
                const selected = await open({
                  directory: true,
                  multiple: false,
                  title: t("settings.selectSortRoot"),
                  defaultPath: startPath,
                });
                if (selected) {
                  setSettings({ ...settings, default_sort_root: selected as string });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <FolderOpen size={14} />
              {t("settings.browse")}
            </button>
          </div>
        </div>

        {/* Log retention */}
        <div
          id="log-retention"
          className={`px-5 py-4 flex items-center justify-between transition-colors duration-1000 rounded-lg ${
            highlightSection === "log-retention" ? "bg-blue-900/30 ring-1 ring-blue-500/50" : ""
          }`}
        >
          <div>
            <p className="text-sm font-medium">{t("settings.logRetention")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.logRetentionDesc")}
            </p>
          </div>
          <input
            type="number"
            min={1}
            value={settings.log_retention_days}
            onChange={(e) =>
              setSettings({
                ...settings,
                log_retention_days: parseInt(e.target.value) || 1,
              })
            }
            className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-right"
          />
        </div>

        {/* Max storage */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.maxStorage")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.maxStorageDesc")}
            </p>
          </div>
          <input
            type="number"
            min={0}
            step={256}
            value={settings.max_storage_mb}
            onChange={(e) =>
              setSettings({
                ...settings,
                max_storage_mb: parseInt(e.target.value) || 0,
              })
            }
            className="w-24 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-right"
          />
        </div>

        {/* Deletion time */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("settings.deletionTime")}</p>
            <p className="text-xs text-zinc-500">
              {t("settings.deletionTimeDesc")}
            </p>
          </div>
          <input
            type="number"
            min={0}
            max={23}
            value={settings.deletion_time_hour}
            onChange={(e) =>
              setSettings({
                ...settings,
                deletion_time_hour: Math.max(0, Math.min(23, parseInt(e.target.value) || 0)),
              })
            }
            className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-right"
          />
        </div>
      </div>

      {/* Update mode selector */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t("settings.updateMode")}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {t(`settings.updateModeDesc_${settings.update_mode}`)}
              </p>
            </div>
            <div className="flex bg-zinc-800 rounded-lg p-0.5 gap-0.5">
              {(["off", "notify", "auto"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSettings({ ...settings, update_mode: mode })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    settings.update_mode === mode
                      ? "bg-blue-600 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t(`settings.updateMode_${mode}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={checkingUpdate}
              onClick={async () => {
                setCheckingUpdate(true);
                setUpdateCheckResult(null);
                try {
                  const update = await check();
                  if (update) {
                    setUpdateCheckResult(t("update.available", { version: update.version }));
                  } else {
                    setUpdateCheckResult(t("update.upToDate"));
                    setTimeout(() => setUpdateCheckResult(null), 5000);
                  }
                } catch {
                  setUpdateCheckResult(t("update.error"));
                  setTimeout(() => setUpdateCheckResult(null), 5000);
                } finally {
                  setCheckingUpdate(false);
                }
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg transition-colors text-zinc-300"
            >
              <RefreshCw size={13} className={checkingUpdate ? "animate-spin" : ""} />
              {t("settings.checkForUpdates")}
            </button>
            {updateCheckResult && (
              <span className="text-xs text-zinc-400">{updateCheckResult}</span>
            )}
          </div>
        </div>
      </div>

      {/* Import / Export */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{t("settings.importExport")}</h3>
          <p className="text-xs text-zinc-500">{t("settings.importExportDesc")}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={async () => {
              try {
                const filePath = await save({
                  defaultPath: "folder-organizer-config.json",
                  filters: [{ name: "JSON", extensions: ["json"] }],
                  title: t("settings.exportConfig"),
                });
                if (!filePath) return;
                await api.exportConfig(filePath);
                await message(t("settings.exportSuccess"), { title: t("settings.exportConfig"), kind: "info" });
              } catch (err: any) {
                await message(t("settings.exportError", { error: String(err) }), { title: t("settings.exportConfig"), kind: "error" });
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors"
          >
            <Download size={14} />
            {t("settings.exportConfig")}
          </button>
          <button
            onClick={async () => {
              try {
                const filePath = await open({
                  multiple: false,
                  filters: [{ name: "JSON", extensions: ["json"] }],
                  title: t("settings.importConfig"),
                });
                if (!filePath) return;
                await api.importConfig(filePath as string);
                await message(t("settings.importSuccess"), { title: t("settings.importConfig"), kind: "info" });
                // Reload config into UI
                const cfg = await api.getConfig();
                setConfig(cfg);
                setSettings(cfg.settings);
                // Restart watcher with imported settings
                api.restartWatcher().catch(() => {});
              } catch (err: any) {
                await message(t("settings.importError", { error: String(err) }), { title: t("settings.importConfig"), kind: "error" });
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors"
          >
            <Upload size={14} />
            {t("settings.importConfig")}
          </button>
        </div>
      </div>

      {/* Data storage summary */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Database size={16} className="text-zinc-400" />
            {t("settings.dataStorage")}
          </h3>
          <button
            onClick={() => navigate("/data")}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <ExternalLink size={12} />
            {t("settings.openDataExplorer")}
          </button>
        </div>

        {dbStats ? (
          <div className="space-y-2">
            {/* Size bars */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">{t("settings.database")}</span>
              <span className="text-zinc-300">{formatBytes(dbStats.db_size_bytes)}</span>
            </div>
            {settings.max_storage_mb > 0 && (
              <div className="w-full bg-zinc-800 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    dbStats.db_size_bytes / (settings.max_storage_mb * 1024 * 1024) > 0.9
                      ? "bg-red-500"
                      : dbStats.db_size_bytes / (settings.max_storage_mb * 1024 * 1024) > 0.7
                        ? "bg-yellow-500"
                        : "bg-blue-500"
                  }`}
                  style={{
                    width: `${Math.min(100, (dbStats.db_size_bytes / (settings.max_storage_mb * 1024 * 1024)) * 100)}%`,
                  }}
                />
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">{t("settings.trashStaging")}</span>
              <span className="text-zinc-300">{formatBytes(dbStats.trash_size_bytes)}</span>
            </div>

            {/* Per-table row counts */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
              {dbStats.tables.map((tbl) => (
                <div key={tbl.table_name} className="flex justify-between">
                  <span className="text-zinc-500">{tbl.table_name}</span>
                  <span className="text-zinc-400">{t("settings.rows", { count: tbl.row_count })}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">{t("common.loading")}</p>
        )}

        <p className="text-xs text-zinc-600 leading-relaxed">
          {t("settings.localStorageNote")}{" "}
          <code className="text-zinc-500">{dbPath || "%APPDATA%\\folder-organizer\\"}</code>.
          {" "}{t("settings.noCloud")}
        </p>
      </div>
    </div>
  );
}
