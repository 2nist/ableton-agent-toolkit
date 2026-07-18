// The `osc` package ships no TypeScript types and there's no @types/osc.
// This covers only the UDPPort surface this package actually uses, with
// metadata mode left at its default (false) — see bridge.ts — so `args`
// on a received message is an array of plain values, not {type,value}
// pairs (confirmed from node_modules/osc/README.md).
declare module "osc" {
  export interface OscMessage {
    address: string;
    args: unknown[];
  }

  export interface UDPPortOptions {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    metadata?: boolean;
  }

  export class UDPPort {
    constructor(options: UDPPortOptions);
    on(event: "message", handler: (message: OscMessage) => void): void;
    on(event: "ready" | "error" | "close", handler: (...args: unknown[]) => void): void;
    open(): void;
    close(): void;
    send(message: { address: string; args?: unknown[] }): void;
  }

  const osc: { UDPPort: typeof UDPPort };
  export default osc;
}
