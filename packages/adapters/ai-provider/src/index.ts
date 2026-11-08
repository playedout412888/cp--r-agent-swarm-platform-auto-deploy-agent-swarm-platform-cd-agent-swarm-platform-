export type AiGenerationResult = {
  status: "unavailable";
  reason: "missing_api_key" | "adapter_disabled";
};

/**
 * Gate A AI adapter. Fails closed without keys and never calls a provider.
 * Live model invocation is out of scope until a later authorized gate.
 */
export async function generateBriefNarrative(): Promise<AiGenerationResult> {
  if (!process.env.AI_PROVIDER_API_KEY) {
    return { status: "unavailable", reason: "missing_api_key" };
  }
  return { status: "unavailable", reason: "adapter_disabled" };
}
