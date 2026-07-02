import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MousePointerClick } from "lucide-react";
import * as api from "../api";

/**
 * One-time dialog asking whether to add "Watch with Folder Organizer" to the
 * Explorer right-click menu. Shows on first startup — or after updating from
 * a version without the setting — until the user answers. The choice is
 * stored in settings and can be changed anytime from the Settings page.
 */
export function ContextMenuPrompt() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    api.getConfig().then((cfg) => {
      if (!cfg.settings.context_menu_prompted) setVisible(true);
    });
  }, []);

  const answer = async (enabled: boolean) => {
    setVisible(false);
    try {
      // Re-fetch so we don't clobber settings changed since mount
      const cfg = await api.getConfig();
      await api.saveConfig({
        ...cfg,
        settings: {
          ...cfg.settings,
          context_menu_enabled: enabled,
          context_menu_prompted: true,
        },
      });
    } catch (err) {
      console.error("Failed to save context menu choice:", err);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600/20 rounded-lg">
            <MousePointerClick size={20} className="text-blue-400" />
          </div>
          <h3 className="text-base font-semibold">
            {t("contextMenuPrompt.title")}
          </h3>
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed">
          {t("contextMenuPrompt.body")}
        </p>
        <p className="text-xs text-zinc-500">{t("contextMenuPrompt.hint")}</p>
        <div className="flex gap-3 pt-1">
          <button
            onClick={() => answer(true)}
            autoFocus
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
          >
            {t("contextMenuPrompt.enable")}
          </button>
          <button
            onClick={() => answer(false)}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
          >
            {t("contextMenuPrompt.notNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
