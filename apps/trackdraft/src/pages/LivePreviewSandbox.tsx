import { useState, useEffect, useCallback } from "react";
import { Puck } from "@measured/puck";
import { generatedPuckConfig } from "../puck.generated";
import { initializeSandboxStyles } from "@devkit/puck-engine";

const SAVE_URL = "/api/save-sandbox";

type SaveStatus = "idle" | "saving" | "saved" | "error";
export default function LivePreviewSandbox() {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    initializeSandboxStyles();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadLayout() {
      try {
        const mod = await import("../data/sandbox-layout.json");
        if (!cancelled) setData((mod as { default?: Record<string, unknown> }).default ?? {});
      } catch {
        if (!cancelled) setData({});
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    loadLayout();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePublish = useCallback(async (newData: unknown) => {
    setSaveStatus("saving");
    try {
      const res = await fetch(SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newData),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus("saved");
      console.log("✅ Sandbox layout saved to server:", newData);
    } catch (err) {
      setSaveStatus("error");
      console.error("❌ Failed to save sandbox layout:", err);
    }
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full text-inkMuted text-sm">
        Loading layout…
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {saveStatus !== "idle" && (
        <div
          className={`absolute top-3 right-3 z-50 px-3 py-1.5 rounded text-xs font-medium ${
            saveStatus === "saving"
              ? "bg-panelAlt text-inkMuted"
              : saveStatus === "saved"
                ? "bg-ok/20 text-ok border border-ok/30"
                : "bg-danger/20 text-danger border border-danger/30"
          }`}
        >
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "✓ Saved"}
          {saveStatus === "error" && "✕ Save failed"}
        </div>
      )}

      <Puck config={generatedPuckConfig} data={data} onPublish={handlePublish} />
    </div>
  );
}