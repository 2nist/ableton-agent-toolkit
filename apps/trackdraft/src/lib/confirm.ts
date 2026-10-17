/**
 * Promise-based confirmation, backed by the shared Modal. Replaces the
 * browser's native `confirm()` (blocking, unstyled, and inconsistent with
 * the Ableton chrome) without every caller needing a provider.
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (value: boolean) => void;
}

let current: ConfirmRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  // A second prompt supersedes the first rather than stacking.
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { ...options, id: nextId++, resolve };
    emit();
  });
}

export function getConfirmRequest(): ConfirmRequest | null {
  return current;
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function settleConfirm(value: boolean): void {
  const request = current;
  if (!request) return;
  current = null;
  emit();
  request.resolve(value);
}
