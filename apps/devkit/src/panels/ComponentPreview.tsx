import { Suspense, lazy, useMemo, Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { ComponentEntry } from "../lib/componentRegistry.generated";
import { getByName, componentLookup } from "../lib/componentRegistry.generated";

interface Props {
  componentName: string | null;
  cssOverrides?: string;
}

/** Error boundary fallback */
function PreviewError({ error }: { error?: Error }) {
  return (
    <div className="p-4 text-sm text-red-400 border border-red-500/30 rounded bg-red-500/10">
      <p className="font-semibold mb-1">Render Error</p>
      <p className="text-xs text-inkMuted">{error?.message ?? "Unknown error loading component"}</p>
    </div>
  );
}

/** Loading skeleton */
function PreviewLoader() {
  return (
    <div className="p-4 space-y-3 animate-pulse">
      <div className="h-4 bg-edge rounded w-1/3" />
      <div className="h-8 bg-edge rounded w-full" />
      <div className="h-8 bg-edge rounded w-2/3" />
    </div>
  );
}

/**
 * Per-component error boundary. Catches prop-mismatch errors (common when
 * previewing components without a full app context) without crashing the
 * entire dashboard.
 */
class ComponentErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[DevKit] "${this.props.name}" crashed in preview:`, error.message);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-sm text-amber-400 border border-amber-500/30 rounded bg-amber-500/10">
          <p className="font-semibold mb-1">Preview Note</p>
          <p className="text-xs text-inkMuted">{this.state.error.message}</p>
          <p className="text-[10px] text-inkMuted/50 mt-1">
            This component likely needs mock props. Add <code>defaultProps</code> to its registry entry.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Dynamic component loader using the auto-generated componentLookup map.
 */
function DynamicPreview({ entry }: { entry: ComponentEntry }) {
  const LazyComponent = useMemo(() => {
    const loader = componentLookup[entry.name];
    if (!loader) {
      return () => <PreviewError error={new Error(`No lazy loader for "${entry.name}" in generated registry.`)} />;
    }
    return lazy<ComponentType<unknown>>(() =>
      loader().then((mod) => ({
        default: mod.default as ComponentType<unknown>,
      })),
    );
  }, [entry.name]);

  const props = entry.defaultProps ?? {};

  return (
    <Suspense fallback={<PreviewLoader />}>
      <div className="rounded-lg bg-panel p-4 min-h-[120px]">
        <ComponentErrorBoundary name={entry.name}>
          <LazyComponent {...props} />
        </ComponentErrorBoundary>
      </div>
    </Suspense>
  );
}

export default function ComponentPreview({ componentName, cssOverrides }: Props) {
  const entry = componentName ? getByName(componentName) : undefined;

  return (
    <div className="h-full flex flex-col bg-canvas rounded-lg border border-edge overflow-hidden">
      <div className="px-3 py-2 border-b border-edge flex items-center justify-between shrink-0">
        <h2 className="text-xs font-semibold text-inkMuted uppercase tracking-wider">
          Preview
        </h2>
        {entry && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full border"
            style={{
              borderColor: categoryColor(entry.category),
              color: categoryColor(entry.category),
            }}
          >
            {entry.category}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!componentName ? (
          <div className="flex items-center justify-center h-full text-inkMuted text-sm">
            <p>Click a component in the graph to preview it here.</p>
          </div>
        ) : !entry ? (
          <PreviewError error={new Error(`Component "${componentName}" not in registry`)} />
        ) : (
          <div className="space-y-3">
            <div className="p-3 rounded bg-panelAlt border border-edge">
              <h3 className="text-sm font-semibold text-ink">{entry.name}</h3>
              <p className="text-xs text-inkMuted mt-1">{entry.description}</p>
              {entry.deps.length > 0 && (
                <p className="text-xs text-inkMuted mt-1">
                  Depends on: {entry.deps.join(", ")}
                </p>
              )}
              <p className="text-[10px] text-inkMuted/60 mt-1 font-mono">
                {entry.path}.tsx
              </p>
            </div>

            <div className={cssOverrides ?? ""}>
              <DynamicPreview entry={entry} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function categoryColor(cat: ComponentEntry["category"]): string {
  const map: Record<ComponentEntry["category"], string> = {
    harmony: "#6366f1",
    structure: "#10b981",
    lyrics: "#f59e0b",
    layout: "#ec4899",
    dashboard: "#06b6d4",
    details: "#8b5cf6",
  };
  return map[cat];
}