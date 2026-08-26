/** Generates a UUID v4 string that works in every context TrackDraft runs
 *  in.
 *
 *  `crypto.randomUUID()` is only exposed in secure contexts (and Safari
 *  15.4+). When the app is served over the LAN — e.g. an iPad loading
 *  `http://192.168.4.26:5183`, which is plain HTTP and therefore NOT a
 *  secure context — `crypto.randomUUID` is `undefined`, and any "create
 *  song / apply template / add section" call would throw. This falls back
 *  to `crypto.getRandomValues` (always available) and then Math.random,
 *  so creation never crashes on a phone/tablet on the network. */
export function uuid(): string {
  // Deliberately does NOT check `crypto.randomUUID` here — that check would
  // recurse once the polyfill installs `crypto.randomUUID = uuid`. Always
  // build from `crypto.getRandomValues` (available in every context,
  // including insecure HTTP LAN origins), falling back to Math.random.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Polyfills `crypto.randomUUID` when the environment (insecure HTTP LAN
 *  origin, or older Safari) doesn't expose it — so every existing
 *  `crypto.randomUUID()` call site keeps working without a rewrite. Runs
 *  once at app startup (before any user action can call it). */
export function ensureCryptoRandomUUID(): void {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID === "function") return;
  try {
    Object.defineProperty(crypto, "randomUUID", {
      value: uuid,
      writable: true,
      configurable: true,
    });
  } catch {
    // Non-extensible `crypto` (unlikely) — call sites should use uuid().
  }
}
