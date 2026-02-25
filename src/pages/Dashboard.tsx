import { useEffect, useState } from "react";
import {
  FolderOpen,
  Activity,
  Play,
  Pause,
  RefreshCw,
} from "lucide-react";
import * as api from "../api";
import type { AppConfig, ActivityLogEntry } from "../types";

export default function Dashboard() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityLogEntry[]>([]);
  const [watcherRunning, setWatcherRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [cfg, log, status] = await Promise.all([
        api.getConfig(),
        api.getActivityLog(10),
        api.getWatcherStatus(),
      ]);
      setConfig(cfg);
      setRecentActivity(log);
      setWatcherRunning(status);
    } catch (e) {
      console.error("Failed to load dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleWatcher = async () => {
    if (watcherRunning) {
      await api.stopWatcher();
    } else {
      await api.restartWatcher();
    }
    setWatcherRunning(!watcherRunning);
  };

  const handleScan = async () => {
    await api.scanNow();
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading...
      </div>
    );
  }

  const enabledFolders = config?.folders.filter((f) => f.enabled).length ?? 0;
  const totalRules =
    config?.folders.reduce((sum, f) => sum + f.rules.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex gap-2">
          <button
            onClick={handleScan}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium transition-colors"
          >
            <RefreshCw size={16} />
            Scan Now
          </button>
          <button
            onClick={toggleWatcher}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              watcherRunning
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-green-600 hover:bg-green-500"
            }`}
          >
            {watcherRunning ? <Pause size={16} /> : <Play size={16} />}
            {watcherRunning ? "Pause" : "Start"}
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="flex items-center gap-3 text-zinc-400 mb-2">
            <FolderOpen size={20} />
            <span className="text-sm font-medium">Watched Folders</span>
          </div>
          <p className="text-3xl font-bold">{enabledFolders}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="flex items-center gap-3 text-zinc-400 mb-2">
            <Activity size={20} />
            <span className="text-sm font-medium">Active Rules</span>
          </div>
          <p className="text-3xl font-bold">{totalRules}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="flex items-center gap-3 text-zinc-400 mb-2">
            <div
              className={`w-3 h-3 rounded-full ${
                watcherRunning ? "bg-green-500" : "bg-zinc-600"
              }`}
            />
            <span className="text-sm font-medium">Watcher Status</span>
          </div>
          <p className="text-3xl font-bold">
            {watcherRunning ? "Running" : "Stopped"}
          </p>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="font-semibold">Recent Activity</h3>
        </div>
        {recentActivity.length === 0 ? (
          <div className="px-5 py-8 text-center text-zinc-500 text-sm">
            No activity yet. Add folders and rules to get started.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {recentActivity.map((entry) => (
              <div
                key={entry.id}
                className="px-5 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{entry.file_name}</p>
                  <p className="text-xs text-zinc-500">
                    {entry.action} — {entry.rule_name ?? "manual"}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      entry.result === "success"
                        ? "bg-green-900/50 text-green-400"
                        : "bg-red-900/50 text-red-400"
                    }`}
                  >
                    {entry.result}
                  </span>
                  <p className="text-xs text-zinc-500 mt-1">
                    {entry.timestamp}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
