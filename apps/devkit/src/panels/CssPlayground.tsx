import { useState, useEffect, useCallback } from "react";
import { HexColorPicker } from "react-colorful";
import { loadTokens, saveTokens, type CssToken } from "../lib/cssVariables";

interface Props {
  cssOverrides: string;
  onCssOverridesChange: (value: string) => void;
}

/**
 * CSS Playground panel.
 * - Theme token editor: color pickers, reset button
 * - Tailwind class injector: type classes to apply to the preview
 */
export default function CssPlayground({ cssOverrides, onCssOverridesChange }: Props) {
  const [tokens, setTokens] = useState<CssToken[]>(() => loadTokens());
  const [expandedColor, setExpandedColor] = useState<string | null>(null);

  // Persist tokens to localStorage whenever they change
  useEffect(() => {
    saveTokens(tokens);
  }, [tokens]);

  // Apply tokens to document root so they cascade into the preview
  useEffect(() => {
    const root = document.documentElement;
    for (const token of tokens) {
      root.style.setProperty(token.name, token.value);
    }
  }, [tokens]);

  const updateToken = useCallback((name: string, value: string) => {
    setTokens((prev) => prev.map((t) => (t.name === name ? { ...t, value } : t)));
  }, []);

  const resetTokens = useCallback(() => {
    setTokens(loadTokens());
  }, []);

  const colorTokens = tokens.filter((t) => t.category === "color");

  return (
    <div className="h-full flex flex-col bg-canvas rounded-lg border border-edge overflow-hidden">
      <div className="px-3 py-2 border-b border-edge flex items-center justify-between shrink-0">
        <h2 className="text-xs font-semibold text-inkMuted uppercase tracking-wider">
          CSS Playground
        </h2>
        <button
          className="text-[10px] text-inkMuted hover:text-ink border border-edge rounded px-2 py-0.5 hover:bg-panelAlt"
          onClick={resetTokens}
        >
          Reset
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Tailwind class injector */}
        <div>
          <label className="text-[10px] text-inkMuted uppercase tracking-wider mb-1 block">
            Tailwind class overrides
          </label>
          <input
            type="text"
            className="w-full bg-panelAlt border border-edge rounded px-2 py-1.5 text-xs text-ink placeholder:text-inkMuted/40 outline-none focus:border-accent"
            placeholder="e.g. bg-red-500 p-4 rounded-lg shadow-xl"
            value={cssOverrides}
            onChange={(e) => onCssOverridesChange(e.target.value)}
          />
          <p className="text-[9px] text-inkMuted/50 mt-1">
            Classes applied to preview wrapper. Clear to reset.
          </p>
        </div>

        {/* Color tokens */}
        <div>
          <label className="text-[10px] text-inkMuted uppercase tracking-wider mb-2 block">
            Theme Colors
          </label>
          <div className="space-y-2">
            {colorTokens.map((token) => (
              <div key={token.name}>
                <button
                  className="w-full flex items-center gap-2 text-xs hover:bg-panelAlt rounded px-1 py-1"
                  onClick={() => setExpandedColor(expandedColor === token.name ? null : token.name)}
                >
                  <span
                    className="w-5 h-5 rounded border border-edge shrink-0"
                    style={{ backgroundColor: token.value }}
                  />
                  <span className="text-inkMuted truncate flex-1 text-left">
                    {token.name.replace("--tw-color-", "")}
                  </span>
                  <span className="text-[10px] text-inkMuted/60 font-mono">
                    {token.value}
                  </span>
                </button>
                {expandedColor === token.name && (
                  <div className="mt-2 mb-3 flex flex-col items-center gap-2">
                    <HexColorPicker
                      color={token.value}
                      onChange={(val) => updateToken(token.name, val)}
                      style={{ width: "100%", height: "120px" }}
                    />
                    <input
                      type="text"
                      className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-center text-[10px] font-mono text-ink"
                      value={token.value}
                      onChange={(e) => updateToken(token.name, e.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}