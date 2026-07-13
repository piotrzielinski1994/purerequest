import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "src-tauri/gen"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Code-based TanStack routes colocate the route object with its component
    // by design, and useReactTable trips a known react-hooks v7 false positive.
    files: ["src/routes/**/*.tsx", "src/components/demo-table.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // The workspace context is split into concern factories that take an
    // `internals` bag (state/setters/refs) and are called inside the provider's
    // value memo. Each factory only reads a ref's `.current` inside the closures
    // it returns (event handlers / async send loop), never during render - but
    // react-hooks/refs can't see through the bag and flags every factory call.
    files: ["src/components/workspace/workspace-context/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "off",
    },
  },
);
