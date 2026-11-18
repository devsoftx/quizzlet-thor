// @ts-check
// Lint rules for the whole repository. Run with `npm run lint`.
import js from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintReactRules = eslintReact.configs["recommended-type-checked"].rules ?? {};

// eslint-react ships its own copies of the React team's hooks rules. Both are
// on below, so its copies are turned off: each problem is reported once.
/** @type {import("eslint").Linter.RulesRecord} */
const hooksRuleCopies = Object.fromEntries(
  Object.keys(reactHooks.configs.flat.recommended.rules ?? {})
    .map((rule) => rule.replace("react-hooks/", "@eslint-react/"))
    .filter((rule) => rule in eslintReactRules)
    .map((rule) => /** @type {const} */ ([rule, "off"])),
);

export default defineConfig(
  globalIgnores(["dist/", "build/", ".vercel/", "playwright-report/", "test-results/", "blob-report/"]),

  { linterOptions: { reportUnusedDisableDirectives: "error" } },

  js.configs.recommended,

  // TypeScript, with the rules that use type information. Each file is checked
  // against the tsconfig.json that covers it (src/, e2e/ or the root one).
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Files no tsconfig.json includes.
          allowDefaultProject: ["playwright.config.ts", "scripts/*.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A leading underscore marks a name as unused on purpose, as it does for tsc.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // The in-memory stores implement the same promise-returning interfaces as
      // the real ones, so their methods are async without awaiting anything.
      "@typescript-eslint/require-await": "off",
      // An async function is fine as an event handler (onClick={save}).
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    },
  },

  // The browser app: React.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite(),
      eslintReact.configs["recommended-type-checked"],
    ],
    languageOptions: { globals: globals.browser },
    rules: hooksRuleCopies,
  },

  // Everything else runs in Node: the functions, scripts, tests and configs.
  {
    files: ["api/**", "server/**", "scripts/**", "e2e/**", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },

  // Tests read JSON responses and mocks, which are loosely typed by nature.
  {
    files: ["**/*.test.{ts,tsx}", "**/test-support.ts", "e2e/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
