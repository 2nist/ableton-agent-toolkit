import { useState } from "react";
import ComponentGraph from "./panels/ComponentGraph";
import ComponentPreview from "./panels/ComponentPreview";
import CssPlayground from "./panels/CssPlayground";
import LivePreviewSandbox from "./pages/LivePreviewSandbox";
import RenderCanvasLayout from "./components/RenderCanvasLayout";

type Tab = "dashboard" | "sandbox";
type ViewMode = "edit" | "preview";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Components" },
  { id: "sandbox", label: "Puck Sandbox" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [dashboardViewMode, setDashboardViewMode] = useState<ViewMode>("preview");
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [cssOverrides, setCssOverrides] = useState("");

  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-ink">
      {/* Header */}
      <header className="shrink-0 border-b border-edge px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold tracking-tight">
            <span className="text-accent">Dev</span>Kit
            <span className="text-inkMuted text-xs font-normal ml-2">
              {activeTab === "dashboard" ? "trackdraft component dashboard" : "visual layout editor"}
            </span>
          </h1>
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`px-3 py-1 text-xs rounded ${
                  activeTab === tab.id ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        {activeTab === "dashboard" && selectedComponent && (
          <span className="text-xs text-inkMuted">
            Selected: <span className="text-ink font-mono">{selectedComponent}</span>
          </span>
        )}
        {activeTab === "sandbox" && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-inkMuted uppercase tracking-wider mr-1">View:</span>
            <button
              className={`px-2 py-0.5 text-[11px] rounded ${
                dashboardViewMode === "edit" ? "bg-accent/20 text-accent" : "text-inkMuted hover:text-ink"
              }`}
              onClick={() => setDashboardViewMode("edit")}
            >
              Edit
            </button>
            <button
              className={`px-2 py-0.5 text-[11px] rounded ${
                dashboardViewMode === "preview" ? "bg-accent/20 text-accent" : "text-inkMuted hover:text-ink"
              }`}
              onClick={() => setDashboardViewMode("preview")}
            >
              Preview
            </button>
          </div>
        )}
      </header>

      {/* Main content */}
      {activeTab === "sandbox" ? (
        <main className="flex-1 min-h-0">
          {dashboardViewMode === "edit" ? (
            <LivePreviewSandbox />
          ) : (
            <div className="h-full overflow-auto">
              <RenderCanvasLayout />
            </div>
          )}
        </main>
      ) : (
        <main className="flex-1 flex gap-3 p-3 min-h-0">
          {/* Left: Dependency Graph */}
          <section className="w-[42%] min-w-0">
            <ComponentGraph
              selectedComponent={selectedComponent}
              onSelectComponent={setSelectedComponent}
            />
          </section>

          {/* Right: Preview + CSS stacked vertically */}
          <section className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
            <div className="flex-1 min-h-0">
              <ComponentPreview
                componentName={selectedComponent}
                cssOverrides={cssOverrides}
              />
            </div>
            <div className="h-[42%] shrink-0">
              <CssPlayground
                cssOverrides={cssOverrides}
                onCssOverridesChange={setCssOverrides}
              />
            </div>
          </section>
        </main>
      )}
    </div>
  );
}