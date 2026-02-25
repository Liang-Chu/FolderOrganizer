import { v4 as uuidv4 } from "uuid";
import type { Rule, Action } from "../../types";

// ── Types ───────────────────────────────────────────────────

export type ActionType = "Move" | "Delete" | "Ignore";

// ── Helper Functions ────────────────────────────────────────

export function defaultAction(type: ActionType): Action {
  switch (type) {
    case "Move":
      return { type: "Move", destination: "" };
    case "Delete":
      return { type: "Delete", after_days: 30 };
    case "Ignore":
      return { type: "Ignore" };
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
  };
}

export function actionLabel(action: Action): string {
  switch (action.type) {
    case "Move":
      return `Move to ${action.destination || "…"}`;
    case "Delete":
      return `Delete after ${action.after_days} day${action.after_days !== 1 ? "s" : ""}`;
    case "Ignore":
      return "Ignore";
  }
}

export function conditionSummary(text: string): string {
  if (!text || text === "*") return "Match all files";
  return text;
}
