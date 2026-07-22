export function initializeSandboxStyles() {
  if (typeof window === "undefined") return;

  // Guard clause to prevent duplicate stylesheet attachments
  if (document.getElementById("puck-core-styles")) return;

  // Inject the full Puck CSS stylesheet at runtime so consumers
  // don't need a separate static import.
  const link = document.createElement("link");
  link.id = "puck-core-styles";
  link.rel = "stylesheet";
  // Resolve relative to the puck-engine package dist directory.
  // In a Vite dev server this is served directly from node_modules.
  link.href = new URL("@measured/puck/dist/index.css", import.meta.url).href;
  document.head.appendChild(link);

  const tokens = document.createElement("style");
  tokens.id = "puck-design-tokens";
  tokens.textContent = `
    :root {
      --puck-color-accent: #4f46e5;
      --puck-space-unit: 4px;
    }
  `;
  document.head.appendChild(tokens);

  console.log("🎨 Injected Puck stylesheet and design tokens");
}
