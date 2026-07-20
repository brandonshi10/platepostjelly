type AppLinkEnv = {
  NEXT_PUBLIC_JELLY_IOS_APP_URL?: string;
  NEXT_PUBLIC_JELLY_ANDROID_APP_URL?: string;
};

const defaultLinks = {
  ios: "https://apps.apple.com/us/app/jellyjelly-human-social/id6505022038",
  android: "https://play.google.com/store/apps/details?id=app.jellyjelly.prod",
};

export function getJellyAppLinks(env?: AppLinkEnv) {
  const source = env ?? {
    NEXT_PUBLIC_JELLY_IOS_APP_URL: process.env.NEXT_PUBLIC_JELLY_IOS_APP_URL,
    NEXT_PUBLIC_JELLY_ANDROID_APP_URL: process.env.NEXT_PUBLIC_JELLY_ANDROID_APP_URL,
  };

  return {
    ios: source.NEXT_PUBLIC_JELLY_IOS_APP_URL || defaultLinks.ios,
    android: source.NEXT_PUBLIC_JELLY_ANDROID_APP_URL || defaultLinks.android,
  };
}
