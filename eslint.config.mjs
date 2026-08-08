import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

const scriptFiles = [
  "client/app/**/*.ts",
  "client/model/**/*.ts",
  "client/storage/**/*.ts",
  "client/configuration/**/*.ts",
  "client/phase0/**/*.{js,ts}",
  "e2e/**/*.ts",
  "*.config.mjs",
  "playwright.config.ts",
  "vite.config.ts",
];
const svelteFiles = ["client/phase0/**/*.svelte"];
const scopedSvelteConfigs = svelte.configs.recommended.map((config) => ({
  ...config,
  files: svelteFiles,
}));

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: scriptFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  ...scopedSvelteConfigs,
  {
    files: svelteFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  prettier,
);
