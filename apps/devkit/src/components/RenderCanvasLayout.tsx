import { Render } from "@measured/puck";
import { generatedPuckConfig } from "../puck.generated";
import savedLayoutData from "../data/sandbox-layout.json";

export default function RenderCanvasLayout() {
  // Gracefully handle situations where no canvas blueprint has been written yet
  if (!savedLayoutData || !(savedLayoutData as Record<string, unknown>).content) {
    return (
      <div className="p-8 text-center border border-dashed border-slate-300 rounded-lg m-4">
        <p className="text-slate-500">No layout blueprint discovered inside sandbox-layout.json.</p>
        <p className="text-xs text-slate-400 mt-1">
          Open the /sandbox route to create and save a visual arrangement.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-white">
      <Render config={generatedPuckConfig} data={savedLayoutData as any} />
    </div>
  );
}