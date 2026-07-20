import { describe, expect, it } from "vitest";
import {
  canStartMission,
  isMissionComplete,
  missionStatusLabel,
} from "../src/lib/jellyhunt/map-ui";

describe("Jellyhunt consumer mission state UX", () => {
  it("only opens the camera for a new or rejected mission", () => {
    expect(canStartMission("not_started")).toBe(true);
    expect(canStartMission("rejected")).toBe(true);
    expect(canStartMission("submitted")).toBe(false);
    expect(canStartMission("approved")).toBe(false);
    expect(canStartMission("reward_failed")).toBe(false);
  });

  it("keeps a passport stamp after approval while reward delivery resolves", () => {
    expect(isMissionComplete("approved")).toBe(true);
    expect(isMissionComplete("reward_queued")).toBe(true);
    expect(isMissionComplete("reward_sent")).toBe(true);
    expect(isMissionComplete("reward_failed")).toBe(true);
    expect(isMissionComplete("reward_uncertain")).toBe(true);
    expect(isMissionComplete("needs_review")).toBe(false);
  });

  it("gives every server status an audience-facing label", () => {
    expect(missionStatusLabel("submitted")).toBe("Submitted");
    expect(missionStatusLabel("reward_failed")).toBe("Mission complete · reward needs attention");
    expect(missionStatusLabel("reward_uncertain")).toBe("Mission complete · reward reconciling");
  });
});
