import { useState, useEffect } from "react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import {
  LayoutDashboard,
  FolderOpen,
  Database,
  Settings,
  Copy,
  Check,
} from "lucide-react";
import { UpdateChecker } from "./UpdateChecker";

const navItems = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { to: "/folders", icon: FolderOpen, labelKey: "nav.folders" },
  { to: "/data", icon: Database, labelKey: "nav.data" },
  { to: "/settings", icon: Settings, labelKey: "nav.settings" },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("");
  const [copied, setCopied] = useState(false);

  const feedbackEmail = "liamchudev@outlook.com";

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(feedbackEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v));
  }, []);

  return (
    <aside className="w-56 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">
      <div className="px-5 py-4 border-b border-zinc-800">
        <h1 className="text-lg font-bold text-white tracking-tight">
          {t("app.name")}
        </h1>
      </div>
      <nav className="flex-1 px-3 py-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`
            }
          >
            <item.icon size={18} />
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
      <UpdateChecker />
      <div className="px-2 pb-2">
        <div className="text-[12px] text-zinc-300 mb-1 font-medium pl-1">{t("sidebar.feedback")}</div>
        <div className="flex items-stretch">
          <code className="text-[11px] h-7 w-[150px] px-2 rounded-l-md bg-zinc-800 border border-zinc-700 border-r-0 text-zinc-300 truncate inline-flex items-center">
            {feedbackEmail}
          </code>
          <button
            onClick={handleCopyEmail}
            className={`inline-flex h-7 items-center justify-center px-2.5 rounded-r-md border border-zinc-700 transition-colors ${
              copied
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                : "bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-200"
            }`}
            title={t("sidebar.copyEmail")}
            aria-label={t("sidebar.copyEmail")}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        v{appVersion}
      </div>
    </aside>
  );
}
