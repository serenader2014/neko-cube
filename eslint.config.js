import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import importX from "eslint-plugin-import-x";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";

/**
 * Project lint gate. The high-value rules here exist to prevent the exact
 * problems this codebase hit before: giant single files, copy-pasted code,
 * circular dependencies, and dead imports. See AGENTS.md for the conventions.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "data/**",
      ".dev/**",
      "geoip/**",
      "public/**",
      "scripts/**",
      "**/*.config.{js,ts}",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "unused-imports": unusedImports,
      "import-x": importX,
      sonarjs,
    },
    rules: {
      // --- Structure: keep files small, force extraction into modules ---
      "max-lines": ["error", { max: 1200, skipBlankLines: false, skipComments: false }],
      "max-lines-per-function": ["warn", { max: 400, skipBlankLines: true, skipComments: true, IIFEs: true }],

      // --- Reuse / no copy-paste (caught the duplicated glyphs & pagers) ---
      "sonarjs/no-identical-functions": "warn",
      "no-duplicate-imports": "error",

      // --- Architecture: no circular deps between feature-folder layers ---
      "import-x/no-cycle": ["error", { maxDepth: 6 }],

      // --- Dead code: unused imports/vars must not accumulate ---
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],

      // --- React correctness ---
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // --- Relaxed: this codebase intentionally uses any/unknown/casts at IO boundaries ---
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },
  // Test files: relax structure/size rules.
  {
    files: ["src/test/**/*.{ts,tsx}"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "sonarjs/no-identical-functions": "off",
    },
  },
);
