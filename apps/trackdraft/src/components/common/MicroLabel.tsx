import type { ReactNode } from "react";

export default function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-3xs font-mono uppercase tracking-wider text-inkMuted">{children}</span>
  );
}
