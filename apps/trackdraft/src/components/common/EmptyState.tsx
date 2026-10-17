import type { ReactNode } from "react";

/** Quiet empty-state block: one line of explanation plus an optional action. */
export default function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-edge/70 rounded px-4 py-6 text-center">
      <p className="text-xs text-inkMuted">{title}</p>
      {hint && <p className="text-[10px] text-inkMuted/60 mt-1">{hint}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
