import { describe, expect, it } from "vitest";

import { APIRequestError } from "../../lib/api";
import { translationActionError } from "./translationErrors";

describe("translationActionError", () => {
  it("explains both deployment and local translation variable names", () => {
    const error = new APIRequestError(503, {
      error: { code: "service_unavailable", message: "Translation provider is not configured" },
    });

    const message = translationActionError(error, "翻译失败");

    expect(message).toContain("GitHub Variable PORTFOLIO_TRANSLATION_PROVIDER=deepseek");
    expect(message).toContain("Secret PORTFOLIO_TRANSLATION_API_KEY");
    expect(message).toContain("TRANSLATION_PROVIDER");
    expect(message).toContain("TRANSLATION_API_KEY");
  });
});
