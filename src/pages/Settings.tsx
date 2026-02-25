import { useEffect, useState } from "react";
import { Save, FolderOpen, Database, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router";
import * as api from "../api";
import type { AppConfig, AppSettings, DbStats } from "../types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [dbPath, setDbPath] = useState("");
  const navigate = useNavigate();

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

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Settings</h2>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
        >
          <Save size={16} />
          {saved ? "Saved!" : "Save"}
        </button>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
        {/* Scan interval */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Scan Interval</p>
            <p className="text-xs text-zinc-500">
              How often to check for scheduled actions (minutes)
            </p>
          </div>
          <input
            type="number"
            min={1}
            value={settings.scan_interval_minutes}
            onChange={(e) =>
              setSettings({
                ...settings,
                scan_interval_minutes: parseInt(e.target.value) || 1,
              })
            }
            className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-right"
          />
        </div>

        {/* Start with OS */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Start with Windows</p>
            <p className="text-xs text-zinc-500">
              Launch automatically when you log in
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
            <p className="text-sm font-medium">Minimize to Tray</p>
            <p className="text-xs text-zinc-500">
              Keep running in system tray when window is closed
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
            <p className="text-sm font-medium">Notifications</p>
            <p className="text-xs text-zinc-500">
              Show toast notifications when files are processed
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
              <p className="text-sm font-medium">Default Sort Root</p>
              <p className="text-xs text-zinc-500">
                Root folder for Move destinations — subfolder names resolve under this path
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
                  title: "Select default sort root",
                  defaultPath: startPath,
                });
                if (selected) {
                  setSettings({ ...settings, default_sort_root: selected as string });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <FolderOpen size={14} />
              Browse
            </button>
          </div>
        </div>

        {/* Log retention */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Log Retention</p>
            <p className="text-xs text-zinc-500">
              Days to keep activity log entries (older entries are auto-deleted)
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
            <p className="text-sm font-medium">Max Storage Size</p>
            <p className="text-xs text-zinc-500">
              Maximum database size in MB (0 = unlimited, default 2048 = 2 GB)
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
      </div>

      {/* Data storage summary */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Database size={16} className="text-zinc-400" />
            Data Storage
          </h3>
          <button
            onClick={() => navigate("/data")}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <ExternalLink size={12} />
            Open Data Explorer
          </button>
        </div>

        {dbStats ? (
          <div className="space-y-2">
            {/* Size bars */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Database</span>
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
              <span className="text-zinc-400">Trash staging</span>
              <span className="text-zinc-300">{formatBytes(dbStats.trash_size_bytes)}</span>
            </div>

            {/* Per-table row counts */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
              {dbStats.tables.map((t) => (
                <div key={t.table_name} className="flex justify-between">
                  <span className="text-zinc-500">{t.table_name}</span>
                  <span className="text-zinc-400">{t.row_count.toLocaleString()} rows</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Loading…</p>
        )}

        <p className="text-xs text-zinc-600 leading-relaxed">
          All data is stored locally at{" "}
          <code className="text-zinc-500">{dbPath || "%APPDATA%\\download-organizer\\"}</code>.
          Nothing is sent to the cloud.
        </p>
      </div>
    </div>
  );
}
