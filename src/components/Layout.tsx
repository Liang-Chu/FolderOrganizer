import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./Sidebar";

export default function Layout() {
  const navigate = useNavigate();

  useEffect(() => {
    const unlisten = listen<string>("navigate-to-folder", (event) => {
      navigate(`/folders?expand=${event.payload}`);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [navigate]);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
