import { v4 as uuidv4 } from "uuid";
import type { Rule, Action } from "../../types";
import type { TFunction } from "i18next";

// ── Types ───────────────────────────────────────────────────

export type ActionType = "Move" | "Delete";

// ── Helper Functions ────────────────────────────────────────

export function defaultAction(type: ActionType): Action {
  switch (type) {
    case "Move":
      return { type: "Move", destination: "" };
    case "Delete":
      return { type: "Delete", after_days: 30 };
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
    action: { type: "Move", destination: "" },
    whitelist: [],
    match_subdirectories: false,
  };
}

export function actionLabel(action: Action, t: TFunction): string {
  switch (action.type) {
    case "Move":
      return `${t("rules.moveTo")} ${action.destination || "…"}`;
    case "Delete":
      return t("rules.deleteAfterDays", { count: action.after_days });
  }
}

export function conditionSummary(text: string, t: TFunction): string {
  if (!text || text === "*") return t("rules.matchAll");
  return text;
}
