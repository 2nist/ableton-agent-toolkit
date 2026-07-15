/**
 * EnviREAment-style call logging: every native-module method call is recorded
 * before/after it runs, so tests can assert on *how* code drove the SDK —
 * not just the resulting state. See `enhanced_virtual_reaper.lua`'s
 * `log_api_call` for the pattern this mirrors.
 */

export interface CallLogEntry {
  method: string;
  args: unknown[];
  ts: number;
}

export class CallLog {
  private entries: CallLogEntry[] = [];

  record(method: string, args: unknown[]): void {
    this.entries.push({ method, args, ts: Date.now() });
  }

  all(): readonly CallLogEntry[] {
    return this.entries;
  }

  filter(method: string): CallLogEntry[] {
    return this.entries.filter((e) => e.method === method);
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * Wraps every function-valued property of `target` so calls are recorded to
 * `log` under `${prefix}.${propertyName}`. Non-function properties (e.g.
 * `EnvironmentModule_1_0_0.storageDirectory`) pass through untouched.
 */
export function withCallLogging<T extends object>(target: T, prefix: string, log: CallLog): T {
  const wrapped = {} as T;
  for (const key of Object.keys(target) as (keyof T)[]) {
    const value = target[key];
    if (typeof value === "function") {
      wrapped[key] = ((...args: unknown[]) => {
        log.record(`${prefix}.${String(key)}`, args);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      }) as T[keyof T];
    } else {
      wrapped[key] = value;
    }
  }
  return wrapped;
}
