import { describe, expect, it } from "vitest";
import { canTransition } from "../../packages/orchestration/src/job-states.js";

describe("job state transitions", () => {
  it("allows the recorded v1 paths", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "succeeded")).toBe(true);
    expect(canTransition("running", "waiting_approval")).toBe(true);
    expect(canTransition("running", "retry_wait")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "unknown")).toBe(true);
    expect(canTransition("waiting_approval", "queued")).toBe(true);
    expect(canTransition("retry_wait", "queued")).toBe(true);
  });

  it("rejects impossible transitions", () => {
    expect(canTransition("succeeded", "queued")).toBe(false);
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("queued", "succeeded")).toBe(false);
  });
});
