import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Download, X, RefreshCw, CheckCircle } from "lucide-react";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; update: Update }
  | { status: "downloading"; progress: number }
  | { status: "ready" }
  | { status: "error"; message: string }
  | { status: "upToDate" };

export function UpdateChecker() {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check for updates 5 seconds after mount, then every 4 hours
    const timer = setTimeout(() => checkForUpdate(), 5000);
    const interval = setInterval(() => checkForUpdate(), 4 * 60 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const checkForUpdate = async () => {
    try {
      setState({ status: "checking" });
      const update = await check();
      if (update) {
        setState({ status: "available", update });
        setDismissed(false);
      } else {
        setState({ status: "upToDate" });
        // Hide the "up to date" message after 3 seconds
        setTimeout(() => setState({ status: "idle" }), 3000);
      }
    } catch (err) {
      console.error("Update check failed:", err);
      setState({ status: "idle" }); // Silently fail on check errors
    }
  };

  const installUpdate = async () => {
    if (state.status !== "available") return;
    const { update } = state;
    try {
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setState({ status: "downloading", progress: 0 });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setState({
              status: "downloading",
              progress: contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0,
            });
            break;
          case "Finished":
            setState({ status: "ready" });
            break;
        }
      });
      setState({ status: "ready" });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  };

  // Nothing to show
  if (state.status === "idle" || dismissed) return null;

  // Checking spinner (only flash briefly)
  if (state.status === "checking") return null;

  // Up to date (brief flash)
  if (state.status === "upToDate") {
    return (
      <div className="mx-4 mb-3 px-3 py-2 bg-green-900/20 border border-green-800/40 rounded-lg flex items-center gap-2 text-xs text-green-400">
        <CheckCircle size={13} />
        {t("update.upToDate")}
      </div>
    );
  }

  // Update available
  if (state.status === "available") {
    return (
      <div className="mx-4 mb-3 px-3 py-2.5 bg-blue-900/20 border border-blue-700/40 rounded-lg text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-blue-300">
            <Download size={13} />
            <span>
              {t("update.available", { version: state.update.version })}
            </span>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-zinc-500 hover:text-zinc-300"
          >
            <X size={12} />
          </button>
        </div>
        <button
          onClick={installUpdate}
          className="mt-2 w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-medium transition-colors"
        >
          {t("update.install")}
        </button>
      </div>
    );
  }

  // Downloading
  if (state.status === "downloading") {
    return (
      <div className="mx-4 mb-3 px-3 py-2.5 bg-blue-900/20 border border-blue-700/40 rounded-lg text-xs text-blue-300">
        <div className="flex items-center gap-2 mb-1.5">
          <RefreshCw size={13} className="animate-spin" />
          {t("update.downloading", { progress: state.progress })}
        </div>
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      </div>
    );
  }

  // Ready — restart required
  if (state.status === "ready") {
    return (
      <div className="mx-4 mb-3 px-3 py-2.5 bg-green-900/20 border border-green-700/40 rounded-lg text-xs text-green-300">
        <div className="flex items-center gap-2">
          <CheckCircle size={13} />
          {t("update.ready")}
        </div>
        <p className="text-[11px] text-zinc-400 mt-1">
          {t("update.readyDesc")}
        </p>
      </div>
    );
  }

  // Error
  if (state.status === "error") {
    return (
      <div className="mx-4 mb-3 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg flex items-center gap-2 text-xs text-red-400">
        <span className="truncate">{t("update.error")}</span>
        <button
          onClick={() => setDismissed(true)}
          className="text-zinc-500 hover:text-zinc-300 flex-shrink-0"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return null;
}
