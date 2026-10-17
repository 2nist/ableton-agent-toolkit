import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Width recipe; defaults to a compact dialog. */
  widthClass?: string;
}

/**
 * The one modal shell: portal, Escape, backdrop dismissal, initial focus,
 * a Tab trap, and focus restoration. Replaces the four hand-rolled
 * `fixed inset-0` overlays over time (ui-standardization Phase 1).
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  widthClass = "w-[min(420px,calc(100vw-2rem))]",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const frame = requestAnimationFrame(() => {
      const target =
        panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${widthClass} border border-edge rounded-lg bg-panel shadow-xl`}
      >
        <header className="flex items-center gap-2 border-b border-edge/70 px-3 py-2">
          <h2 className="text-xs font-medium text-ink">{title}</h2>
        </header>
        <div className="p-3 text-xs text-inkMuted">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-edge/70 px-3 py-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
