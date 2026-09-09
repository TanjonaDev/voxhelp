import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10000,
    // Les smoke tests appellent le vrai Claude (coût réel, non-déterministe) —
    // ils ne tournent que via `pnpm test:smoke` (voir vitest.smoke.config.ts),
    // jamais dans la suite par défaut / CI.
    exclude: ["**/node_modules/**", "**/dist/**", "src/__tests__/smoke/**"],
  },
});
