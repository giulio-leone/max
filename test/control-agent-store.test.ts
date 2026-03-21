import { describe, expect, it } from "vitest";
import { validateHeartbeatPromptInput } from "../src/control-plane/store.js";

describe("control-plane agent prompt validation", () => {
  it("accepts one-shot heartbeat tick prompts", () => {
    expect(() => validateHeartbeatPromptInput("Open Safari now.")).not.toThrow();
  });

  it("rejects recurring heartbeat tick prompts", () => {
    expect(() => validateHeartbeatPromptInput("Open Safari every 30 seconds.")).toThrow(
      /Heartbeat tick prompt must describe one immediate action only/i
    );
  });
});
