import { afterEach, describe, expect, it } from "vitest";
import { generateBriefNarrative } from "../../packages/adapters/ai-provider/src/index.js";

describe("AI adapter", () => {
  const original = process.env.AI_PROVIDER_API_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AI_PROVIDER_API_KEY;
    } else {
      process.env.AI_PROVIDER_API_KEY = original;
    }
  });

  it("fails closed without a key", async () => {
    delete process.env.AI_PROVIDER_API_KEY;
    await expect(generateBriefNarrative()).resolves.toEqual({
      status: "unavailable",
      reason: "missing_api_key",
    });
  });

  it("does not call a live provider when a key is present", async () => {
    process.env.AI_PROVIDER_API_KEY = "not-a-live-key";
    await expect(generateBriefNarrative()).resolves.toEqual({
      status: "unavailable",
      reason: "adapter_disabled",
    });
  });
});
