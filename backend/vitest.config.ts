import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**"],
    env: {
      NODE_ENV: "test",
      // Pin the bind address: the suite must not inherit a HOST from the
      // shell (a backend-spawned shell carries HOST=0.0.0.0, which would
      // trip the fail-closed bind guard when index.test.ts imports main()).
      HOST: "127.0.0.1",
    },
  },
});
