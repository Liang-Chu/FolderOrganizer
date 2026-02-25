import { useEffect, useState, useCallback } from "react";
import {
  Check,
  X,
  AlertCircle,
  TestTube2,
  FolderOpen,
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
  // Pre-fill destination with root path for new rules
  const initialRule = { ...rule };
  if (isNew && initialRule.action.type === "Move" && !initialRule.action.destination) {
    initialRule.action = { type: "Move", destination: defaultSortRoot.replace(/[\\/]$/, "") + "\\" };
  }
  const [draft, setDraft] = useState<Rule>(initialRule);
  const [conditionText, setConditionText] = useState(rule.condition_text || "*");

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
        {isNew ? "New Rule" : "Edit Rule"}
      </h4>

      {/* Name & description */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Name *</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. PDFs to Documents"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">
            Description
          </label>
          <input
            type="text"
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            placeholder="Optional description"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Condition text */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">
          Condition (wildcard syntax)
        </label>
        <div className="relative">
          <input
            type="text"
            value={conditionText}
            onChange={(e) => setConditionText(e.target.value)}
            placeholder="*.pdf AND *invoice*"
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
              <code className="text-zinc-400">*.pdf</code> — glob (wildcard match)
            </span>
            <span>
              <code className="text-zinc-400">*report*</code> — contains "report"
            </span>
            <span>
              <code className="text-zinc-400">?</code> — single character
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>
              <code className="text-zinc-400">AND</code>{" "}
              <code className="text-zinc-400">OR</code>{" "}
              <code className="text-zinc-400">NOT</code> — combinators
            </span>
            <span>
              <code className="text-zinc-400">(…)</code> — grouping
            </span>
          </div>
          <div>
            <span>
              <code className="text-zinc-400">/^IMG_\d+\.jpg$/</code> — regex
              (wrap pattern in <code className="text-zinc-400">/</code> slashes for
              regular expressions)
            </span>
          </div>
          <p className="text-zinc-600 mt-1">
            Examples:{" "}
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
          Test against filename
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={testFileName}
            onChange={(e) => setTestFileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTest()}
            placeholder="invoice_2026.pdf"
            className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleTest}
            disabled={!testFileName.trim() || !conditionValid}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 rounded-lg text-sm transition-colors"
          >
            <TestTube2 size={14} />
            Test
          </button>
          {testResult !== null && (
            <span
              className={`flex items-center gap-1 text-sm font-medium ${testResult ? "text-green-400" : "text-red-400"}`}
            >
              {testResult ? (
                <>
                  <Check size={14} /> Match
                </>
              ) : (
                <>
                  <X size={14} /> No match
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">Action</label>
        <div className="flex gap-2 mb-3">
          {(["Move", "Delete", "Ignore"] as ActionType[]).map((t) => (
            <button
              key={t}
              onClick={() => handleActionTypeChange(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                actionType === t
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {actionType === "Move" && draft.action.type === "Move" && (
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Destination folder *
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
                    title: "Select destination folder",
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
                Browse
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
              Delete after (days)
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
              0 = delete on next scan
            </p>
          </div>
        )}

        {actionType === "Ignore" && (
          <p className="text-xs text-zinc-500">
            Matching files will be skipped by all subsequent rules.
          </p>
        )}
      </div>

      {/* Enabled toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="accent-blue-600"
        />
        <span className="text-sm text-zinc-300">Enabled</span>
      </label>

      {/* Save / Cancel */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
        >
          {isNew ? "Create Rule" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
