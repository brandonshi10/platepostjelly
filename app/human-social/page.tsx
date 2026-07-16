import "./jellyhunt.css";
import { getJellyAppLinks } from "@/src/lib/app-links";
import {
  getMissionResponse,
  JellyhuntDataError,
} from "@/src/lib/jellyhunt/convex-repository";
import { JellyhuntExplorer } from "./jellyhunt-explorer";
import type { MissionsResponse } from "@/src/lib/jellyhunt/contracts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PlatePost x JellyJelly: Human Social!",
  description: "Find nearby Jellyhunt missions, post real moments, and earn rewards through JellyJelly.",
};

export default async function HumanSocialPage() {
  let response: MissionsResponse = {
    apiVersion: "1.0",
    generatedAt: new Date().toISOString(),
    missions: [],
  };
  let dataError: string | undefined;

  try {
    response = await getMissionResponse();
  } catch (error) {
    dataError =
      error instanceof JellyhuntDataError
        ? "Connect a PlatePost Convex deployment, or enable the local fixture source for development."
        : "Mission data could not be loaded.";
  }

  return (
    <JellyhuntExplorer
      missions={response.missions}
      userStatus={response.userStatus}
      appLinks={getJellyAppLinks()}
      mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}
      dataError={dataError}
    />
  );
}
