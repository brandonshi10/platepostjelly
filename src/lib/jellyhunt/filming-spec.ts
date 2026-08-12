/**
 * What a clip has to be for PlatePost to actually use it.
 *
 * A mission that only says "film the eclair" gets back footage the videomenu
 * pipeline cannot use, and nobody finds out until a restaurant is looking at a
 * black tile. Every rule here is taken from the PlatePost side rather than
 * invented, and each one records where it comes from.
 */

export type FilmingRule = {
  id: string;
  label: string;
  detail: string;
};

/**
 * Vertical, because every video template is vertical.
 *
 * From `lib/template-config.ts` in the PlatePost app: Key wants 9:16 at
 * 720x1280, Hugo and Lemon want 4:5 at 1080x1350, Yoto wants 1:1. Only
 * Owamni's 16:9 slot is horizontal and that one takes a still, not a clip.
 *
 * 9:16 is the only shape that crops down into all of the others. A landscape
 * clip crops into none of them, so it is the one mistake that cannot be fixed
 * after the fact.
 */
export const CAPTURE_ASPECT = "9:16";
export const CAPTURE_MIN_WIDTH = 1080;

export const FILMING_RULES: readonly FilmingRule[] = [
  {
    id: "vertical",
    label: "Hold the phone upright",
    detail:
      "Vertical, 9:16. Every videomenu layout is vertical, and an upright clip can be cropped to fit them all. A sideways one cannot be rescued.",
  },
  {
    id: "compatible",
    label: "iPhone: switch to Most Compatible",
    detail:
      "Settings → Camera → Formats → Most Compatible. The default, High Efficiency, records HEVC, which browsers cannot play — it has already turned a live dish into a black tile.",
  },
  {
    id: "no-hdr",
    label: "Turn HDR video off",
    detail:
      "Settings → Camera → Record Video → HDR off. 10-bit video breaks hardware decoding on a lot of phones even when the codec is fine.",
  },
  {
    id: "steady",
    label: "One steady take, no zoom",
    detail:
      "Move the phone rather than pinching to zoom, and keep the dish in frame the whole time. Clips are trimmed, never stabilised.",
  },
  {
    id: "light",
    label: "Put the light behind you",
    detail:
      "Shoot with the window or lamp at your back. Backlit food goes to silhouette and cannot be graded back.",
  },
] as const;

/** The one-line version, for a mission row. */
export function captureSummary(minSeconds: number, maxSeconds: number): string {
  return `Vertical ${CAPTURE_ASPECT} · ${minSeconds}–${maxSeconds}s`;
}

/**
 * Is a filmed clip usable by the videomenu pipeline?
 *
 * Mirrors `codecIsWebPlayable` and `needsTranscode` in the PlatePost app:
 * h264/vp8/vp9/av1 only, 8-bit `yuv420p` only. Kept here so the mission side
 * can reject a clip at submission time instead of discovering it downstream.
 */
export const WEB_PLAYABLE_VIDEO_CODECS = ["h264", "vp8", "vp9", "av1"] as const;

export function clipIsUsable(input: {
  codec?: string | null;
  pixelFormat?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
}): { usable: boolean; reason?: string } {
  const { codec, pixelFormat, widthPx, heightPx } = input;

  if (!codec) return { usable: false, reason: "unknown_codec" };
  if (!(WEB_PLAYABLE_VIDEO_CODECS as readonly string[]).includes(codec)) {
    return { usable: false, reason: "codec_not_web_playable" };
  }
  // 10-bit plays in some browsers and fails on many phones, so it is rejected
  // rather than accepted-and-hoped-for.
  if (pixelFormat && pixelFormat !== "yuv420p") {
    return { usable: false, reason: "pixel_format_not_8_bit" };
  }
  if (widthPx && heightPx) {
    if (widthPx > heightPx) return { usable: false, reason: "landscape" };
    if (widthPx < 720) return { usable: false, reason: "too_small" };
  }
  return { usable: true };
}
