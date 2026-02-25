import { useEffect, useState } from "react";
import { FolderPlus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { open, message } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import type { WatchedFolder } from "../types";

export default function Folders() {
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFolders = async () => {
    try {
      setFolders(await api.getWatchedFolders());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadFolders();
  }, []);

  const handleAdd = async () => {
    if (busy) return;
    setError(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select folder to watch", defaultPath: "C:\\" });
      if (!selected) return; // user cancelled

      setBusy(true);
      await api.addWatchedFolder(selected as string);
      await loadFolders();
      try {
        await api.restartWatcher();
      } catch (watchErr: any) {
        console.warn("Watcher restart failed:", watchErr);
      }
    } catch (e: any) {
      const errMsg = String(e);
      setError(errMsg);
      await message(errMsg, { title: "Failed to add folder", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await api.removeWatchedFolder(id);
      await loadFolders();
      await api.restartWatcher().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      await api.toggleWatchedFolder(id, enabled);
      await loadFolders();
      await api.restartWatcher().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Watched Folders</h2>
        <button
          onClick={handleAdd}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        >
          <FolderPlus size={16} />
          {busy ? "Adding…" : "Watch Another Folder"}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {/* Folder list */}
      {folders.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-12 text-center text-zinc-500">
          No folders being watched yet. Click "Watch Another Folder" to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-4 flex items-center justify-between"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{folder.path}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {folder.rules.length} rule{folder.rules.length !== 1 && "s"}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <button
                  onClick={() => handleToggle(folder.id, !folder.enabled)}
                  className={`transition-colors ${
                    folder.enabled ? "text-green-400" : "text-zinc-600"
                  }`}
                  title={folder.enabled ? "Disable" : "Enable"}
                >
                  {folder.enabled ? (
                    <ToggleRight size={24} />
                  ) : (
                    <ToggleLeft size={24} />
                  )}
                </button>
                <button
                  onClick={() => handleRemove(folder.id)}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
