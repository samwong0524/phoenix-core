import next from "eslint-config-next";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { phoenixStyles } from "./eslint-rules/no-hardcoded-inline-styles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "drizzle/**",
      "tests/**",
      "hermes-agent/**",
      "LOStudio-Fork/**",
    ],
  },
  ...next,
  {
    plugins: {
      "phoenix-styles": phoenixStyles,
    },
    rules: {
      // Warn on hardcoded colors in inline styles — use var(--*) or Tailwind utilities
      "phoenix-styles/no-hardcoded-inline-styles": "warn",
    },
  },
];
