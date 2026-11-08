import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      CONTROL_PLANE_ENV: "development",
      CONTROL_PLANE_TOKEN: "local-dev-controller-token",
      AI_PROVIDER_API_KEY: "",
    },
  },
});
