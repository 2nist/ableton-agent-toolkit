import type { ReactNode } from "react";
import TapeLabel from "../common/TapeLabel";

/**
 * The dashboard's one header. The library view and a directory listing each
 * used to carry their own copy — four lab links included — which is how they
 * drifted apart and how the wordmark ended up painting *under* the theme
 * toggle at narrow widths.
 *
 * The layout rule lives here so it cannot be re-broken at a call site:
 * the identity half shrinks and truncates, the control half never shrinks.
 * Lab links are not controls for songwriting; they live in Settings (§ the
 * workspace doc's own "labs live outside the song editor" rule).
 */
export default function DashboardHeader({
  title,
  onBack,
  stamp,
  badge,
  children,
}: {
  /** Plain text title — used when there is nothing to attach a tape to. */
  title: string;
  onBack?: () => void;
  /** Rendered as the tape wordmark instead of `title` when present. */
  stamp?: string;
  /** Provenance marker shown beside the identity (e.g. the Studio log stamp). */
  badge?: ReactNode;
  /** The control half: counts, legend, actions. Never shrinks. */
  children?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-edge">
      <div className="flex items-center gap-2.5 min-w-0">
        {onBack && (
          <button
            className="text-inkMuted text-xs hover:text-ink shrink-0"
            onClick={onBack}
          >
            ← Back
          </button>
        )}
        {stamp ? (
          <TapeLabel
            size="lg"
            tilt="left"
            className="text-sm font-semibold truncate max-w-full"
          >
            {stamp}
          </TapeLabel>
        ) : (
          <h1 className="text-sm font-semibold truncate">{title}</h1>
        )}
        {badge}
      </div>
      {children ? (
        <div className="flex items-center gap-3 text-[10px] text-inkMuted shrink-0">
          {children}
        </div>
      ) : null}
    </header>
  );
}
