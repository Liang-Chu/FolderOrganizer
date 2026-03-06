import { v4 as uuidv4 } from "uuid";
import type { Rule, Action } from "../../types";
import type { TFunction } from "i18next";

// ── Types ───────────────────────────────────────────────────

export type ActionType = "Move" | "Delete";

// ── Helper Functions ────────────────────────────────────────

export function defaultAction(type: ActionType): Action {
  switch (type) {
    case "Move":
      return { type: "Move", destination: "", delay_minutes: 0, keep_source: false };
    case "Delete":
      return { type: "Delete", delay_minutes: 1440 }; // 1 day default
  }
}

export function createEmptyRule(): Rule {
  return {
    id: uuidv4(),
    name: "",
    description: "",
    enabled: true,
    condition: { type: "Always" },
    condition_text: "*",
    action: { type: "Move", destination: "", delay_minutes: 0, keep_source: false },
    whitelist: [],
    match_subdirectories: false,
  };
}

/** Convert total minutes to { days, hours, minutes } */
export function minutesToParts(totalMinutes: number): { days: number; hours: number; minutes: number } {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}

/** Convert { days, hours, minutes } to total minutes */
export function partsToMinutes(days: number, hours: number, minutes: number): number {
  return days * 1440 + hours * 60 + minutes;
}

export function actionLabel(action: Action, t: TFunction): string {
  switch (action.type) {
    case "Move": {
      const dest = action.destination || "…";
      const isCopy = !!action.keep_source;
      if (action.delay_minutes > 0) {
        const key = isCopy ? "rules.copyAfter" : "rules.moveAfter";
        return `${t(key, { time: formatDelayTime(action.delay_minutes, t) })} ${dest}`;
      }
      return `${t(isCopy ? "rules.copyTo" : "rules.moveTo")} ${dest}`;
    }
    case "Delete":
      return t("rules.deleteAfter", { time: formatDelayTime(action.delay_minutes, t) });
  }
}

/** Format delay_minutes into a human-readable string like "1d 2h 30m" */
export function formatDelayTime(totalMinutes: number, t: TFunction): string {
  if (totalMinutes <= 0) return t("rules.immediate");
  const { days, hours, minutes } = minutesToParts(totalMinutes);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}${t("rules.dayShort")}`);
  if (hours > 0) parts.push(`${hours}${t("rules.hourShort")}`);
  if (minutes > 0) parts.push(`${minutes}${t("rules.minuteShort")}`);
  return parts.join(" ") || t("rules.immediate");
}

export function conditionSummary(text: string, t: TFunction): string {
  if (!text || text === "*") return t("rules.matchAll");
  return text;
}
