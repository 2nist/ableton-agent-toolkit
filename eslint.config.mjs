import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Repo-wide lint gate. Deliberately non-type-aware (fast, one pass over all
 * 23 workspaces) and scoped to correctness rules that catch real defects
 * rather than style opinions — formatting is not enforced yet.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/release/**",
      "**/*.d.ts",
      "**/puck.generated.tsx",
      "**/generated/**",
      "**/scripts/output/**",
      // Local Python venvs live in the repo but are not our source: without
      // this, `npm run lint` walks ~430 MB of site-packages (and reports a
      // warning from a vendored urllib3 worker).
      "**/.whisper-venv/**",
      "**/__pycache__/**",
      "**/e-gmd-v1.0.0/**",
      // The native plug-in's CMake build holds the fetched JUCE tree, which
      // ships its own JavaScript examples. Not our source, and not lint-able.
      "plugins/**/build/**",
      "archive/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The codebase already uses `any` at a handful of deliberate SDK
      // boundaries; that is tracked by the audit, not the lint gate.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-control-regex": "off",
      "prefer-const": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
