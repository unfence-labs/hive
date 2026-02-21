import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**"],
    env: {
      NODE_ENV: "test",
    },
  },
});
