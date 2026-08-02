import { describe, expect, it } from "vitest";

import viteConfig from "../../vite.config";

describe("Vite development server", () => {
  it("proxies API and media requests to the local Go backend", () => {
    const config = viteConfig as {
      server?: {
        proxy?: Record<string, { changeOrigin?: boolean; target?: string }>;
      };
    };

    for (const route of ["/api", "/media", "/uploads"]) {
      expect(config.server?.proxy?.[route]).toEqual({
        changeOrigin: true,
        target: "http://127.0.0.1:18080",
      });
    }
  });
});
