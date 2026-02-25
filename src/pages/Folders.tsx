import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Trash2, ToggleLeft, ToggleRight, ShieldCheck, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { open, message } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import type { WatchedFolder } from "../types";

export default function Folders() {
  const { t } = useTranslation();
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
      const selected = await open({ directory: true, multiple: false, title: t("folders.selectFolder"), defaultPath: "C:\\" });
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
      await message(errMsg, { title: t("folders.failedToAdd"), kind: "error" });
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

  // ── Folder whitelist ──────────────────────────────────
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [whitelistInput, setWhitelistInput] = useState("");

  const handleSaveWhitelist = async (folderId: string, whitelist: string[]) => {
    await api.setFolderWhitelist(folderId, whitelist);
    await loadFolders();
  };

  const addWhitelistPattern = async (folderId: string) => {
    const pattern = whitelistInput.trim();
    if (!pattern) return;
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const updated = [...folder.whitelist, pattern];
    await handleSaveWhitelist(folderId, updated);
    setWhitelistInput("");
  };

  const removeWhitelistPattern = async (folderId: string, idx: number) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const updated = [...folder.whitelist];
    updated.splice(idx, 1);
    await handleSaveWhitelist(folderId, updated);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("folders.title")}</h2>
        <button
          onClick={handleAdd}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        >
          <FolderPlus size={16} />
          {busy ? t("folders.adding") : t("folders.addFolder")}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {/* Folder list */}
      {folders.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-12 text-center text-zinc-500">
          {t("folders.noFolders")}
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map((folder) => {
            const isExpanded = expandedFolder === folder.id;
            return (
              <div
                key={folder.id}
                className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden"
              >
                <div className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button
                      onClick={() => setExpandedFolder(isExpanded ? null : folder.id)}
                      className="text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{folder.path}</p>
                      <p className="text-xs text-zinc-500 mt-1">
                        {t("folders.ruleCount", { count: folder.rules.length })}
                        {folder.whitelist.length > 0 && (
                          <span className="ml-2 text-emerald-500">
                            <ShieldCheck size={10} className="inline mr-0.5" />
                            {t("folders.whitelistCount", { count: folder.whitelist.length })}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <button
                      onClick={() => handleToggle(folder.id, !folder.enabled)}
                      className={`transition-colors ${
                        folder.enabled ? "text-green-400" : "text-zinc-600"
                      }`}
                      title={folder.enabled ? t("folders.disable") : t("folders.enable")}
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
                      title={t("folders.remove")}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {/* Whitelist panel */}
                {isExpanded && (
                  <div className="px-5 pb-4 pt-1 border-t border-zinc-800">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ShieldCheck size={14} className="text-emerald-400" />
                      <span className="text-xs font-medium text-emerald-400">{t("folders.whitelist")}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mb-3">{t("folders.whitelistDesc")}</p>

                    {folder.whitelist.length > 0 && (
                      <div className="space-y-1.5 mb-3">
                        {folder.whitelist.map((pattern, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono">
                              {pattern}
                            </span>
                            <button
                              onClick={() => removeWhitelistPattern(folder.id, idx)}
                              className="text-zinc-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={expandedFolder === folder.id ? whitelistInput : ""}
                        onChange={(e) => setWhitelistInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addWhitelistPattern(folder.id);
                        }}
                        placeholder={t("folders.whitelistPlaceholder")}
                        className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={() => addWhitelistPattern(folder.id)}
                        disabled={!whitelistInput.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 rounded-lg text-sm transition-colors"
                      >
                        <Plus size={14} />
                        {t("folders.whitelistAdd")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
