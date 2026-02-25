import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import type { Action } from "../../types";
import { actionLabel } from "./helpers";

interface ActionDisplayProps {
  action: Action;
}

/** Renders action info with a clickable destination path for Move rules. */
export function ActionDisplay({ action }: ActionDisplayProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const handleOpenFolder = async (path: string) => {
    try {
      setError(null);
      await api.ensureDir(path);
      await api.openInExplorer(path);
    } catch (err: any) {
      setError(String(err));
    }
  };

  if (action.type === "Move") {
    return (
      <span>
        {t("rules.moveTo")}{" "}
        {action.destination ? (
          <>
            <span
              onClick={(e) => {
                e.stopPropagation();
                handleOpenFolder(action.destination);
              }}
              className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
              title="Open in File Explorer"
            >
              {action.destination}
            </span>
            {error && (
              <span className="block text-red-400 text-xs mt-0.5" title={error}>
                {t("rules.failedToOpen", { error })}
              </span>
            )}
          </>
        ) : (
          "…"
        )}
      </span>
    );
  }

  return <span>{actionLabel(action, t)}</span>;
}
