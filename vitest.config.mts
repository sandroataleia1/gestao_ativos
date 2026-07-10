import { defineConfig } from "vitest/config";

// Testes de backend/isolamento de tenant: ambiente `node` (não jsdom) porque
// não renderizamos React — exercitamos Route Handlers e os helpers de auth
// diretamente. `resolve.tsconfigPaths` (nativo do Vite) dá suporte ao alias
// `@/*` do tsconfig, sem precisar do plugin externo.
//
// `fileParallelism: false`: os testes são de integração e batem no mesmo
// Postgres. Rodar os arquivos em série evita corrida de fixtures e tempestade
// de conexões — o custo é pequeno (poucos arquivos) e a confiabilidade é maior.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
