import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  X,
  AlertCircle,
  TestTube2,
  FolderOpen,
  Plus,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import * as api from "../../api";
import type { Rule } from "../../types";
import { type ActionType, defaultAction } from "./helpers";

interface RuleEditorProps {
  rule: Rule;
  isNew: boolean;
  defaultSortRoot: string;
  onSave: (rule: Rule) => void;
  onCancel: () => void;
}

export function RuleEditor({ rule, isNew, defaultSortRoot, onSave, onCancel }: RuleEditorProps) {
  const { t } = useTranslation();
  // Pre-fill destination with root path for new rules
  const initialRule = { ...rule };
  if (isNew && initialRule.action.type === "Move" && !initialRule.action.destination) {
    initialRule.action = { type: "Move", destination: defaultSortRoot.replace(/[\\/]$/, "") + "\\" };
  }
  const [draft, setDraft] = useState<Rule>(initialRule);
  const [conditionText, setConditionText] = useState(rule.condition_text || "*");
  const [whitelistInput, setWhitelistInput] = useState("");

  const [conditionError, setConditionError] = useState<string | null>(null);
  const [conditionValid, setConditionValid] = useState(true);
  const [testFileName, setTestFileName] = useState("");
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [actionType, setActionType] = useState<ActionType>(rule.action.type);

  // Debounced condition validation
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!conditionText.trim() || conditionText.trim() === "*") {
        setConditionError(null);
        setConditionValid(true);
        return;
      }
      try {
        await api.validateConditionText(conditionText);
        setConditionError(null);
        setConditionValid(true);
      } catch (err: any) {
        setConditionError(String(err));
        setConditionValid(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [conditionText]);

  // Live test
  const handleTest = useCallback(async () => {
    if (!testFileName.trim()) return;
    try {
      const cond = await api.parseConditionText(conditionText);
      const result = await api.testCondition(cond, testFileName);
      setTestResult(result);
    } catch {
      setTestResult(null);
    }
  }, [conditionText, testFileName]);

  // Reset test result when inputs change
  useEffect(() => {
    setTestResult(null);
  }, [conditionText, testFileName]);

  const handleActionTypeChange = (newType: ActionType) => {
    setActionType(newType);
    if (newType === "Move") {
      setDraft({ ...draft, action: { type: "Move", destination: defaultSortRoot.replace(/[\\/]$/, "") + "\\" } });
    } else {
      setDraft({ ...draft, action: defaultAction(newType) });
    }
  };

  const [destError, setDestError] = useState<string | null>(null);

  const handleSave = async () => {
    // Validate destination folder for Move actions
    if (draft.action.type === "Move" && draft.action.destination) {
      try {
        await api.ensureDir(draft.action.destination.replace(/[\\/]+$/, ""));
        setDestError(null);
      } catch (err: any) {
        setDestError(String(err));
        return;
      }
    }
    try {
      const condition = await api.parseConditionText(conditionText);
      onSave({
        ...draft,
        condition,
        condition_text: conditionText,
      });
    } catch (err: any) {
      setConditionError(String(err));
    }
  };

  const canSave =
    draft.name.trim() !== "" &&
    conditionValid &&
    (draft.action.type !== "Move" ||
      (draft.action.type === "Move" && draft.action.destination.trim() !== ""));

  return (
    <div className="bg-zinc-900 rounded-xl border border-blue-600 p-5 space-y-5">
      <h4 className="font-semibold text-blue-400">
        {isNew ? t("rules.newRule") : t("rules.editRule")}
      </h4>

      {/* Name & description */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">{t("rules.name")} *</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t("rules.namePlaceholder")}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">
            {t("rules.description")}
          </label>
          <input
            type="text"
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            placeholder={t("rules.descriptionPlaceholder")}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Condition text */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">
          {t("rules.condition")}
        </label>
        <div className="relative">
          <input
            type="text"
            value={conditionText}
            onChange={(e) => setConditionText(e.target.value)}
            placeholder={t("rules.conditionPlaceholder")}
            className={`w-full px-3 py-2 bg-zinc-800 border rounded-lg text-sm font-mono focus:outline-none ${
              conditionError
                ? "border-red-500 focus:border-red-500"
                : conditionValid
                  ? "border-zinc-700 focus:border-blue-500"
                  : "border-zinc-700"
            }`}
          />
          {conditionValid && conditionText.trim() && !conditionError && (
            <Check
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400"
            />
          )}
          {conditionError && (
            <AlertCircle
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400"
            />
          )}
        </div>
        {conditionError && (
          <p className="text-xs text-red-400 mt-1">{conditionError}</p>
        )}
        <div className="mt-2 text-xs text-zinc-500 space-y-1">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>
              <code className="text-zinc-400">*.pdf</code> — {t("rules.conditionHelpGlob")}
            </span>
            <span>
              <code className="text-zinc-400">*report*</code> — {t("rules.conditionHelpContains")}
            </span>
            <span>
              <code className="text-zinc-400">?</code> — {t("rules.conditionHelpSingle")}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>
              <code className="text-zinc-400">AND</code>{" "}
              <code className="text-zinc-400">OR</code>{" "}
              <code className="text-zinc-400">NOT</code> — {t("rules.conditionHelpCombinators")}
            </span>
            <span>
              <code className="text-zinc-400">(…)</code> — {t("rules.conditionHelpGrouping")}
            </span>
          </div>
          <div>
            <span>
              <code className="text-zinc-400">/^IMG_\d+\.jpg$/</code> — {t("rules.conditionHelpRegex")}{" "}
              <code className="text-zinc-400">/</code> {t("rules.conditionHelpRegexSlashes")}
            </span>
          </div>
          <p className="text-zinc-600 mt-1">
            {t("rules.conditionHelpExamples")}{" "}
            <code className="text-zinc-500">*.jpg OR *.png</code>
            {" · "}
            <code className="text-zinc-500">(*.pdf OR *.docx) AND *invoice*</code>
            {" · "}
            <code className="text-zinc-500">NOT *.tmp</code>
            {" · "}
            <code className="text-zinc-500">/^receipt_\d+/</code>
          </p>
        </div>
      </div>

      {/* Live test */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">
          {t("rules.testLabel")}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={testFileName}
            onChange={(e) => setTestFileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTest()}
            placeholder={t("rules.testPlaceholder")}
            className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleTest}
            disabled={!testFileName.trim() || !conditionValid}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 rounded-lg text-sm transition-colors"
          >
            <TestTube2 size={14} />
            {t("rules.testBtn")}
          </button>
          {testResult !== null && (
            <span
              className={`flex items-center gap-1 text-sm font-medium ${testResult ? "text-green-400" : "text-red-400"}`}
            >
              {testResult ? (
                <>
                  <Check size={14} /> {t("rules.match")}
                </>
              ) : (
                <>
                  <X size={14} /> {t("rules.noMatch")}
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">{t("rules.action")}</label>
        <div className="flex gap-2 mb-3">
          {(["Move", "Delete"] as ActionType[]).map((aType) => (
            <button
              key={aType}
              onClick={() => handleActionTypeChange(aType)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                actionType === aType
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
              }`}
            >
              {t(`rules.action${aType}`)}
            </button>
          ))}
        </div>

        {actionType === "Move" && draft.action.type === "Move" && (
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              {t("rules.destination")} *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft.action.destination}
                onChange={(e) => {
                  setDestError(null);
                  setDraft({
                    ...draft,
                    action: { type: "Move", destination: e.target.value },
                  });
                }}
                placeholder={defaultSortRoot + "\\PDFs"}
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={async () => {
                  const startPath = (
                    draft.action.type === "Move" && draft.action.destination
                      ? draft.action.destination
                      : defaultSortRoot
                  ).replace(/[\\/]+$/, "");
                  try { await api.ensureDir(startPath); } catch { /* ignore */ }
                  const selected = await open({
                    directory: true,
                    multiple: false,
                    title: t("rules.selectDestination"),
                    defaultPath: startPath,
                  });
                  if (selected) {
                    setDraft({
                      ...draft,
                      action: { type: "Move", destination: selected as string },
                    });
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <FolderOpen size={14} />
                {t("rules.browse")}
              </button>
            </div>
            {destError && (
              <p className="text-xs text-red-400 mt-1">{destError}</p>
            )}
          </div>
        )}

        {actionType === "Delete" && draft.action.type === "Delete" && (
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              {t("rules.deleteAfter")}
            </label>
            <input
              type="number"
              min={0}
              value={draft.action.after_days}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  action: {
                    type: "Delete",
                    after_days: parseInt(e.target.value) || 0,
                  },
                })
              }
              className="w-32 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-zinc-500 mt-1">
              {t("rules.deleteImmediate")}
            </p>
          </div>
        )}
      </div>

      {/* Rule Whitelist */}
      <div>
        <label className="text-xs text-zinc-400 flex items-center gap-1.5 mb-1">
          <ShieldCheck size={12} />
          {t("rules.whitelist")}
        </label>
        <p className="text-xs text-zinc-500 mb-2">
          {t("rules.whitelistDesc")}
        </p>
        {draft.action.type === "Move" && draft.action.destination && (
          <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-emerald-950/30 border border-emerald-800/50 rounded-lg">
            <ShieldCheck size={12} className="text-emerald-400 flex-shrink-0" />
            <span className="text-xs text-emerald-400">
              {t("rules.autoWhitelist")}: <span className="font-mono">{draft.action.destination}</span>
            </span>
          </div>
        )}
        <div className="space-y-1.5">
          {draft.whitelist.map((pattern, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono">
                {pattern}
              </span>
              <button
                onClick={() => {
                  const updated = [...draft.whitelist];
                  updated.splice(idx, 1);
                  setDraft({ ...draft, whitelist: updated });
                }}
                className="text-zinc-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={whitelistInput}
            onChange={(e) => setWhitelistInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && whitelistInput.trim()) {
                setDraft({ ...draft, whitelist: [...draft.whitelist, whitelistInput.trim()] });
                setWhitelistInput("");
              }
            }}
            placeholder={t("rules.whitelistPlaceholder")}
            className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              if (whitelistInput.trim()) {
                setDraft({ ...draft, whitelist: [...draft.whitelist, whitelistInput.trim()] });
                setWhitelistInput("");
              }
            }}
            disabled={!whitelistInput.trim()}
            className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 rounded-lg text-sm transition-colors"
          >
            <Plus size={14} />
            {t("rules.whitelistAdd")}
          </button>
        </div>
      </div>

      {/* Enabled toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="accent-blue-600"
        />
        <span className="text-sm text-zinc-300">{t("rules.enabled")}</span>
      </label>

      {/* Save / Cancel */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
        >
          {t("rules.cancel")}
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
        >
          {isNew ? t("rules.create") : t("rules.save")}
        </button>
      </div>
    </div>
  );
}
