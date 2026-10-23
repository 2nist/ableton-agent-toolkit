import { THEMES, useThemeStore } from "../../store/themeStore";

/** Switch the chrome palette. Two segments rather than a cycling button:
 *  the state is visible without a tooltip, and there is no third click to
 *  reason about. */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <div
      className="flex items-center rounded border border-edge/70 overflow-hidden shrink-0"
      role="group"
      aria-label="Theme"
      title="Theme — dark chrome or the studio log sheet"
    >
      {THEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={theme === option.id}
          aria-label={`${option.label} theme`}
          title={`${option.label} theme`}
          onClick={() => setTheme(option.id)}
          className={`px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide ${
            theme === option.id ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink"
          }`}
        >
          {compact ? option.label.charAt(0) : option.label}
        </button>
      ))}
    </div>
  );
}
