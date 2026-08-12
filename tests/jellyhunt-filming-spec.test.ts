import { describe, expect, it } from "vitest";
import {
  CAPTURE_ASPECT,
  FILMING_RULES,
  captureSummary,
  clipIsUsable,
} from "../src/lib/jellyhunt/filming-spec";

describe("filming spec", () => {
  it("asks for the one shape that crops into every videomenu layout", () => {
    // Key is 9:16, Hugo and Lemon are 4:5, Yoto is 1:1 — all vertical or square.
    expect(CAPTURE_ASPECT).toBe("9:16");
  });

  it("gives every rule something actionable, not just a warning", () => {
    expect(FILMING_RULES.length).toBeGreaterThanOrEqual(4);
    for (const rule of FILMING_RULES) {
      expect(rule.label.length).toBeGreaterThan(4);
      expect(rule.detail.length).toBeGreaterThan(30);
    }
    // The HEVC default is the one that has actually broken a live menu.
    const compatible = FILMING_RULES.find((r) => r.id === "compatible");
    expect(compatible?.detail).toMatch(/Most Compatible/);
  });

  it("summarises a shot in one line", () => {
    expect(captureSummary(8, 15)).toBe("Vertical 9:16 · 8–15s");
  });

  it("accepts what the pipeline can play", () => {
    expect(clipIsUsable({ codec: "h264", pixelFormat: "yuv420p", widthPx: 1080, heightPx: 1920 }))
      .toEqual({ usable: true });
  });

  it("rejects the exact clip an iPhone records by default", () => {
    // High Efficiency = HEVC in a .mov. This is what black-tiled a live dish.
    expect(clipIsUsable({ codec: "hevc", pixelFormat: "yuv420p", widthPx: 1080, heightPx: 1920 }))
      .toEqual({ usable: false, reason: "codec_not_web_playable" });
  });

  it("rejects 10-bit even when the codec is fine", () => {
    expect(clipIsUsable({ codec: "h264", pixelFormat: "yuv420p10le", widthPx: 1080, heightPx: 1920 }))
      .toEqual({ usable: false, reason: "pixel_format_not_8_bit" });
  });

  it("rejects landscape, which no template can crop from", () => {
    expect(clipIsUsable({ codec: "h264", pixelFormat: "yuv420p", widthPx: 1920, heightPx: 1080 }))
      .toEqual({ usable: false, reason: "landscape" });
  });

  it("rejects a clip too small for a 720px tile", () => {
    expect(clipIsUsable({ codec: "h264", pixelFormat: "yuv420p", widthPx: 480, heightPx: 854 }))
      .toEqual({ usable: false, reason: "too_small" });
  });

  it("does not guess when the codec is unknown", () => {
    expect(clipIsUsable({}).usable).toBe(false);
  });
});
