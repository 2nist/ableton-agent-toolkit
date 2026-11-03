import { useNavigate } from "react-router-dom";
import { songOpeningCopy, type SongOpeningState } from "../../lib/songOpening";

/**
 * What a song route draws when it is not ready to draw the song (§polish.2).
 *
 * `opening` is the shell's own shape — spine strip, left rail, canvas, right
 * rail — as inert skeleton bars, with the reason in the canvas. The point is
 * that the page is never blank and never jumps when the song lands: the bands
 * are already where they will be.
 *
 * `missing` is the honest dead end, with the only way out it can offer.
 */
export default function SongOpening({
  state,
}: {
  state: Exclude<SongOpeningState, "ready">;
}) {
  const navigate = useNavigate();
  const copy = songOpeningCopy(state);

  if (state === "missing") {
    return (
      <div className="p-4" role="status">
        <p className="text-inkMuted">{copy?.title}</p>
        {copy?.detail && (
          <p className="text-[11px] text-inkMuted/70 mt-1">{copy.detail}</p>
        )}
        <button
          className="text-accent text-sm mt-2"
          onClick={() => navigate("/")}
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col" aria-busy="true">
      {/* The spine's band, as bars: identity chip · transport · ribbon. */}
      <div className="shrink-0 h-12 border-b border-edge bg-panel flex items-center gap-3 px-3">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-2.5 w-10" />
        <div className="flex-1" />
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-10" />
      </div>

      <div className="flex-1 flex min-h-0">
        {/* The views rail. */}
        <div className="shrink-0 w-9 border-r border-edge bg-panel flex flex-col items-center gap-3 pt-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-4 w-4" />
          ))}
        </div>

        {/* The canvas — narrow columns where the arrangement will be, with
            the reason centred over them. */}
        <main className="flex-1 min-w-0 bg-canvas relative grid place-items-center">
          <div
            className="absolute inset-6 flex gap-4 opacity-40"
            aria-hidden="true"
          >
            <Skeleton className="h-full w-1/4" />
            <Skeleton className="h-full w-1/3" />
            <Skeleton className="h-full w-1/5" />
          </div>
          <div
            className="relative text-center"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm text-inkMuted">{copy?.title}</p>
            <p className="text-[10px] text-inkMuted/60 mt-1">{copy?.detail}</p>
          </div>
        </main>

        {/* The inspector strip. */}
        <div className="shrink-0 w-9 border-l border-edge bg-panel" />
      </div>
    </div>
  );
}

/** A static bar under `prefers-reduced-motion` — the pulse is decoration, not
 *  information, so nothing is lost by turning it off. */
function Skeleton({ className }: { className: string }) {
  return (
    <span
      className={`block rounded-sm bg-edge/40 motion-safe:animate-pulse ${className}`}
    />
  );
}
