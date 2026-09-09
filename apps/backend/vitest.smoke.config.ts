import { defineConfig } from "vitest/config";

// Config séparée pour les smoke tests LLM (src/__tests__/smoke/) : ils appellent
// le vrai Claude via ANTHROPIC_API_KEY, donc timeout long et jamais inclus dans
// `pnpm test` / CI. Voir src/__tests__/smoke/README.md.
export default defineConfig({
  test: {
    environment: "node",
    // Charge apps/backend/.env (ANTHROPIC_API_KEY) — comme le fait index.ts en
    // prod via `import "dotenv/config"`, mais vitest ne passe pas par index.ts.
    setupFiles: ["dotenv/config"],
    include: ["src/__tests__/smoke/**/*.smoke.test.ts"],
    // Un scénario enchaîne plusieurs tours (Haiku live-assist) + un bilan
    // (Sonnet, 8192 tokens) en série — observé jusqu'à ~45s en pratique, donc
    // large marge plutôt qu'un timeout qui coupe pile à la fin du test.
    testTimeout: 120000,
    hookTimeout: 120000,
    // Les scénarios enchaînent plusieurs appels Claude en série (state partagé
    // par scénario) — pas de parallélisation à l'intérieur d'un fichier.
    fileParallelism: true,
  },
});
