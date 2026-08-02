import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        changeOrigin: true,
        target: "http://127.0.0.1:18080",
      },
      "/media": {
        changeOrigin: true,
        target: "http://127.0.0.1:18080",
      },
      "/uploads": {
        changeOrigin: true,
        target: "http://127.0.0.1:18080",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
