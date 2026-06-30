import next from "eslint-config-next";
import { dirname } from "path";
import { fileURLToPath } from "url";

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
];
