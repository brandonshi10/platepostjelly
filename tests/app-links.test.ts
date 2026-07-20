import { describe, expect, it } from "vitest";
import { getJellyAppLinks } from "../src/lib/app-links";

describe("Jelly app store links", () => {
  it("uses the verified JellyJelly store listings by default", () => {
    const links = getJellyAppLinks({});

    expect(links.ios).toBe("https://apps.apple.com/us/app/jellyjelly-human-social/id6505022038");
    expect(links.android).toBe("https://play.google.com/store/apps/details?id=app.jellyjelly.prod");
  });

  it("uses configured direct store links when provided", () => {
    const links = getJellyAppLinks({
      NEXT_PUBLIC_JELLY_IOS_APP_URL: "https://apps.apple.com/app/example/id123",
      NEXT_PUBLIC_JELLY_ANDROID_APP_URL: "https://play.google.com/store/apps/details?id=com.example",
    });

    expect(links.ios).toBe("https://apps.apple.com/app/example/id123");
    expect(links.android).toBe("https://play.google.com/store/apps/details?id=com.example");
  });
});
