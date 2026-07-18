/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "#0d0d0f",
        panel: "#1a1a1e",
        panelAlt: "#232328",
        edge: "#2e2e34",
        ink: "#e8e8ea",
        inkMuted: "#8a8a92",
        accent: "#ffa500",
      },
    },
  },
  plugins: [],
};
