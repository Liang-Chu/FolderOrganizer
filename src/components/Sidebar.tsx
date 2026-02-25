import { NavLink } from "react-router";
import {
  LayoutDashboard,
  FolderOpen,
  ListChecks,
  Activity,
  Database,
  Settings,
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/folders", icon: FolderOpen, label: "Folders" },
  { to: "/rules", icon: ListChecks, label: "Rules" },
  { to: "/activity", icon: Activity, label: "Activity" },
  { to: "/data", icon: Database, label: "Data" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">
      <div className="px-5 py-4 border-b border-zinc-800">
        <h1 className="text-lg font-bold text-white tracking-tight">
          Download Organizer
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
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        v0.1.0
      </div>
    </aside>
  );
}
