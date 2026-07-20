import { describe, expect, it } from "vitest";

type AdminTimeModule = {
  formatMissionDateTime: (timestamp: number | undefined, timeZone: string) => string;
  parseMissionDateTime: (value: string, timeZone: string) => number | undefined;
};

async function loadAdminTime(): Promise<Partial<AdminTimeModule>> {
  const modulePath = "../src/lib/jellyhunt/admin-time";
  try {
    return (await import(modulePath)) as AdminTimeModule;
  } catch {
    return {};
  }
}

describe("Jellyhunt admin mission schedules", () => {
  it("formats a timestamp in the mission location time zone", async () => {
    const time = await loadAdminTime();
    expect(time.formatMissionDateTime).toBeTypeOf("function");

    expect(
      time.formatMissionDateTime!(Date.UTC(2026, 6, 15, 16), "America/New_York"),
    ).toBe("2026-07-15T12:00");
  });

  it("parses location-local summer and winter times without using the admin browser zone", async () => {
    const time = await loadAdminTime();
    expect(time.parseMissionDateTime).toBeTypeOf("function");

    expect(time.parseMissionDateTime!("2026-07-15T12:00", "America/New_York")).toBe(
      Date.UTC(2026, 6, 15, 16),
    );
    expect(time.parseMissionDateTime!("2026-01-15T12:00", "America/New_York")).toBe(
      Date.UTC(2026, 0, 15, 17),
    );
  });

  it("keeps an empty optional schedule empty", async () => {
    const time = await loadAdminTime();
    expect(time.formatMissionDateTime).toBeTypeOf("function");
    expect(time.parseMissionDateTime).toBeTypeOf("function");

    expect(time.formatMissionDateTime!(undefined, "America/New_York")).toBe("");
    expect(time.parseMissionDateTime!("", "America/New_York")).toBeUndefined();
  });
});
