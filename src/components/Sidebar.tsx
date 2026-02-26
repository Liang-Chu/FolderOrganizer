import { useState, useEffect } from "react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import {
  LayoutDashboard,
  FolderOpen,
  Database,
  Settings,
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
      <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        v{appVersion}
      </div>
    </aside>
  );
}
