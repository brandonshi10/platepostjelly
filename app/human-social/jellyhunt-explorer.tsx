"use client";

import {
  Apple,
  ArrowLeft,
  ArrowUpRight,
  CircleHelp,
  LocateFixed,
  Map as MapIcon,
  Menu,
  Mic2,
  Navigation,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Image from "next/image";
import type { Map as MapboxMap, Marker as MapboxMarker, StyleSpecification } from "mapbox-gl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  JellyhuntMission,
  UserMissionStatus,
} from "@/src/lib/jellyhunt/contracts";
import {
  filterMissions,
  getMissionOpenState,
  haversineDistanceMeters,
} from "@/src/lib/jellyhunt/domain";
import {
  canStartMission,
  isMissionComplete,
  missionStatusLabel,
} from "@/src/lib/jellyhunt/map-ui";

type AppLinks = { ios: string; android: string };
type Coordinates = { latitude: number; longitude: number };
type Theme = "dark" | "wobbles";
type ExperiencePanel = "passport" | "guide" | "leaderboard" | "how" | null;
type MapboxModule = typeof import("mapbox-gl").default;
type MapMarkerEntry = {
  marker: MapboxMarker;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  tooltip: HTMLElement;
};
type LeaderboardScope = "current-season" | "all-time";
type LeaderboardStanding = {
  rank: number;
  username: string;
  approvedMissionCount: number;
};
type LeaderboardLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  standings: LeaderboardStanding[];
};

type Props = {
  missions: JellyhuntMission[];
  userStatus?: UserMissionStatus[];
  appLinks: AppLinks;
  mapboxToken?: string;
  dataError?: string;
};

const EMPTY_STATUSES: UserMissionStatus[] = [];
const LEADERBOARD_ENDPOINTS: Record<LeaderboardScope, string> = {
  "current-season": "/api/v2/jellyhunt/leaderboards/current-season?limit=25",
  "all-time": "/api/v2/jellyhunt/leaderboards/all-time?limit=25",
};
const EMPTY_LEADERBOARD: LeaderboardLoadState = { status: "idle", standings: [] };
const HQ = { latitude: 40.7228, longitude: -73.9881 };
const MAP_BOUNDS = {
  minLatitude: 40.711,
  maxLatitude: 40.734,
  minLongitude: -74.004,
  maxLongitude: -73.978,
};

function jellyhuntMapStyle(theme: Theme): StyleSpecification {
  const light = theme === "wobbles";
  return {
    version: 8,
    name: light ? "Jellyhunt Wobbles" : "Jellyhunt Dark",
    glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
    sources: {
      jellyStreets: {
        type: "vector",
        url: "mapbox://mapbox.mapbox-streets-v8",
      },
    },
    layers: [
      {
        id: "jelly-background",
        type: "background",
        paint: { "background-color": light ? "#e9f8ff" : "#080b1f" },
      },
      {
        id: "jelly-water",
        type: "fill",
        source: "jellyStreets",
        "source-layer": "water",
        paint: { "fill-color": light ? "#c8eff4" : "#07131f" },
      },
      {
        id: "jelly-buildings",
        type: "fill",
        source: "jellyStreets",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": light ? "#d8edf1" : "#121632",
          "fill-outline-color": light ? "#bfdde4" : "#1f2850",
          "fill-opacity": 0.78,
        },
      },
      {
        id: "jelly-road-glow",
        type: "line",
        source: "jellyStreets",
        "source-layer": "road",
        minzoom: 9,
        paint: {
          "line-color": light ? "#7eaac0" : "#31467f",
          "line-opacity": light ? 0.28 : 0.5,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 14, 5, 18, 18],
          "line-blur": light ? 0 : 2,
        },
      },
      {
        id: "jelly-roads",
        type: "line",
        source: "jellyStreets",
        "source-layer": "road",
        minzoom: 9,
        paint: {
          "line-color": light ? "#ffffff" : "#7898df",
          "line-opacity": light ? 0.92 : 0.72,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.45, 14, 1.45, 18, 7],
        },
      },
      {
        id: "jelly-road-labels",
        type: "symbol",
        source: "jellyStreets",
        "source-layer": "road",
        minzoom: 12,
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name"], ""],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 17, 13],
          "text-letter-spacing": 0.12,
          "text-max-angle": 35,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": light ? "#29465d" : "#dbe7ff",
          "text-halo-color": light ? "#effaff" : "#080b1f",
          "text-halo-width": 1.5,
          "text-opacity": 0.78,
        },
      },
    ],
  };
}

const EAST_WEST_STREETS = [
  { latitude: 40.734, label: "E 14TH ST", major: true },
  { latitude: 40.7282, label: "ST MARKS PL", major: true },
  { latitude: 40.7253, label: "BLEECKER ST", major: false },
  { latitude: 40.7245, label: "PRINCE ST", major: true },
  { latitude: 40.7228, label: "E HOUSTON ST", major: true, spine: true },
  { latitude: 40.7218, label: "STANTON ST", major: false },
  { latitude: 40.7211, label: "RIVINGTON ST", major: false },
  { latitude: 40.7203, label: "DELANCEY ST", major: true },
  { latitude: 40.7195, label: "BROOME ST", major: false },
  { latitude: 40.7188, label: "GRAND ST", major: false },
  { latitude: 40.717, label: "CANAL ST", major: true },
];

const NORTH_SOUTH_STREETS = [
  { longitude: -73.9998, label: "BROADWAY", major: true },
  { longitude: -73.9976, label: "LAFAYETTE ST", major: true },
  { longitude: -73.9954, label: "ELIZABETH ST", major: false },
  { longitude: -73.993, label: "BOWERY", major: true },
  { longitude: -73.9912, label: "ESSEX ST", major: false },
  { longitude: -73.9905, label: "2ND AVE", major: true },
  { longitude: -73.9897, label: "ORCHARD ST", major: false },
  { longitude: -73.9876, label: "AVE A", major: false },
];


const difficultyLabels: Record<JellyhuntMission["difficulty"], string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  legendary: "Legendary",
};

function missionState(missionId: string, statuses: UserMissionStatus[]) {
  return statuses.find((status) => status.missionId === missionId)?.status ?? "not_started";
}

function missionAccent(mission: JellyhuntMission) {
  if (mission.difficulty === "legendary") return "#f59e0b";
  if (mission.difficulty === "hard") return "#f43f5e";
  if (mission.difficulty === "medium") return "#a855f7";
  return "#00d4aa";
}

function formatDistance(meters: number) {
  if (meters < 1_000) return `${Math.round(meters)} m`;
  return `${(meters / 1_609.344).toFixed(1)} mi`;
}

function formatClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "pm" : "am";
  const hour = ((hours + 11) % 12) + 1;
  return minutes ? `${hour}:${String(minutes).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

function formatHours(mission: JellyhuntMission) {
  if (mission.venueType === "shows" && mission.showtimes?.length) {
    return `Tonight · ${mission.showtimes.map(formatClock).join(" · ")}`;
  }

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: mission.location.timeZone,
  }).format(new Date());
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const entry = mission.hours[weekdays.indexOf(weekday)];
  if (!entry || entry === "closed") return `${weekday} · Closed`;
  const [start, end] = entry.split("-");
  return `${weekday} · ${formatClock(start)}–${formatClock(end)}`;
}

function projectCoordinates(coordinates: Coordinates) {
  const clampedLatitude = Math.max(
    MAP_BOUNDS.minLatitude,
    Math.min(MAP_BOUNDS.maxLatitude, coordinates.latitude),
  );
  const clampedLongitude = Math.max(
    MAP_BOUNDS.minLongitude,
    Math.min(MAP_BOUNDS.maxLongitude, coordinates.longitude),
  );

  return {
    left:
      ((clampedLongitude - MAP_BOUNDS.minLongitude) /
        (MAP_BOUNDS.maxLongitude - MAP_BOUNDS.minLongitude)) *
      100,
    top:
      (1 -
        (clampedLatitude - MAP_BOUNDS.minLatitude) /
          (MAP_BOUNDS.maxLatitude - MAP_BOUNDS.minLatitude)) *
      100,
  };
}

function parseLeaderboardStandings(payload: unknown): LeaderboardStanding[] {
  if (!payload || typeof payload !== "object") throw new Error("invalid_leaderboard");
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") throw new Error("invalid_leaderboard");
  const standings = (data as { standings?: unknown }).standings;
  if (!Array.isArray(standings)) throw new Error("invalid_leaderboard");

  return standings.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("invalid_leaderboard");
    const standing = entry as Record<string, unknown>;
    if (
      !Number.isInteger(standing.rank) ||
      (standing.rank as number) < 1 ||
      typeof standing.username !== "string" ||
      standing.username.trim().length === 0 ||
      !Number.isInteger(standing.approvedMissionCount) ||
      (standing.approvedMissionCount as number) < 1
    ) {
      throw new Error("invalid_leaderboard");
    }
    return {
      rank: standing.rank as number,
      username: standing.username.trim(),
      approvedMissionCount: standing.approvedMissionCount as number,
    };
  });
}

function nearestCrossStreet(coordinates: Coordinates) {
  const eastWest = [...EAST_WEST_STREETS].sort(
    (left, right) =>
      Math.abs(left.latitude - coordinates.latitude) -
      Math.abs(right.latitude - coordinates.latitude),
  )[0];
  const northSouth = [...NORTH_SOUTH_STREETS].sort(
    (left, right) =>
      Math.abs(left.longitude - coordinates.longitude) -
      Math.abs(right.longitude - coordinates.longitude),
  )[0];
  return `${northSouth.label} & ${eastWest.label}`;
}


export function JellyhuntExplorer({
  missions,
  userStatus: providedUserStatus,
  appLinks,
  mapboxToken,
  dataError,
}: Props) {
  const userStatus = providedUserStatus ?? EMPTY_STATUSES;
  const hasPersonalizedStatus = providedUserStatus !== undefined;
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapboxModuleRef = useRef<MapboxModule | null>(null);
  const mapMarkersRef = useRef(new Map<string, MapMarkerEntry>());
  const hqMarkerRef = useRef<MapboxMarker | null>(null);
  const userMarkerRef = useRef<MapboxMarker | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [experiencePanel, setExperiencePanel] = useState<ExperiencePanel>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [fallbackZoom, setFallbackZoom] = useState(1);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("current-season");
  const [leaderboardReload, setLeaderboardReload] = useState(0);
  const [leaderboards, setLeaderboards] = useState<Record<LeaderboardScope, LeaderboardLoadState>>({
    "current-season": EMPTY_LEADERBOARD,
    "all-time": EMPTY_LEADERBOARD,
  });

  const categories = useMemo(
    () => [...new Set(missions.map((mission) => mission.category))].sort(),
    [missions],
  );

  const filteredMissions = useMemo(
    () => filterMissions(missions, { query, category, status }, userStatus),
    [missions, query, category, status, userStatus],
  );

  const selectedMission = selectedId
    ? filteredMissions.find((mission) => mission.id === selectedId) ?? null
    : null;

  const completedCount = useMemo(
    () => missions.filter((mission) => isMissionComplete(missionState(mission.id, userStatus))).length,
    [missions, userStatus],
  );
  const overlayOpen = menuOpen || experiencePanel !== null;
  const activeLeaderboard = leaderboards[leaderboardScope];

  useEffect(() => {
    if (selectedId && !filteredMissions.some((mission) => mission.id === selectedId)) {
      setSelectedId(filteredMissions[0]?.id ?? null);
    }
  }, [filteredMissions, selectedId]);

  useEffect(() => {
    if (experiencePanel !== "leaderboard") return;
    const controller = new AbortController();
    const scopes: LeaderboardScope[] = ["current-season", "all-time"];

    setLeaderboards((current) => ({
      "current-season": { ...current["current-season"], status: "loading" },
      "all-time": { ...current["all-time"], status: "loading" },
    }));

    async function loadLeaderboard(scope: LeaderboardScope) {
      try {
        const response = await fetch(LEADERBOARD_ENDPOINTS[scope], {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const standings =
          response.status === 404
            ? []
            : response.ok
              ? parseLeaderboardStandings(await response.json())
              : (() => {
                  throw new Error("leaderboard_unavailable");
                })();
        if (controller.signal.aborted) return;
        setLeaderboards((current) => ({
          ...current,
          [scope]: { status: "ready", standings },
        }));
      } catch {
        if (controller.signal.aborted) return;
        setLeaderboards((current) => ({
          ...current,
          [scope]: { status: "error", standings: [] },
        }));
      }
    }

    void Promise.all(scopes.map(loadLeaderboard));
    return () => controller.abort();
  }, [experiencePanel, leaderboardReload]);

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || missions.length === 0) return;

    let cancelled = false;
    let failureTimer: number | undefined;
    let map: MapboxMap | null = null;

    function disposeLiveMap() {
      mapMarkersRef.current.forEach(({ marker }) => marker.remove());
      mapMarkersRef.current.clear();
      hqMarkerRef.current?.remove();
      hqMarkerRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      if (mapRef.current === map) mapRef.current = null;
      if (map) {
        map.remove();
        map = null;
      }
    }

    function failMap() {
      if (cancelled) return;
      setMapFailed(true);
      setMapLoaded(false);
      disposeLiveMap();
    }

    async function mountMap() {
      try {
        setMapFailed(false);
        setMapLoaded(false);
        const mapboxModule = await import("mapbox-gl");
        if (cancelled || !mapContainerRef.current) return;
        const mapboxgl = mapboxModule.default;
        mapboxModuleRef.current = mapboxgl;
        mapboxgl.accessToken = mapboxToken;

        map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: jellyhuntMapStyle("dark"),
          center: [HQ.longitude, HQ.latitude],
          zoom: 12.5,
          attributionControl: true,
        });
        mapRef.current = map;

        const hqElement = document.createElement("div");
        hqElement.className = "hunt-hq hunt-mapbox-hq";
        hqElement.setAttribute("aria-label", "JellyJelly HQ");
        const hqPulse = document.createElement("span");
        hqPulse.className = "hunt-hq-pulse";
        const hqImage = document.createElement("img");
        hqImage.src = "/wobbles/wobble_product.png";
        hqImage.alt = "";
        hqImage.width = 72;
        hqImage.height = 72;
        hqImage.setAttribute("aria-hidden", "true");
        const hqLabel = document.createElement("strong");
        hqLabel.textContent = "JELLYJELLY HQ";
        hqElement.append(hqPulse, hqImage, hqLabel);
        hqMarkerRef.current = new mapboxgl.Marker({ element: hqElement, anchor: "center" })
          .setLngLat([HQ.longitude, HQ.latitude])
          .addTo(map);

        failureTimer = window.setTimeout(() => {
          if (!cancelled && map && !map.loaded()) failMap();
        }, 8_000);

        map.on("load", () => {
          if (cancelled) return;
          if (failureTimer) window.clearTimeout(failureTimer);
          setMapLoaded(true);
        });
        map.on("error", () => {
          if (!cancelled && map && !map.loaded()) failMap();
        });
      } catch {
        failMap();
      }
    }

    void mountMap();

    return () => {
      cancelled = true;
      if (failureTimer) window.clearTimeout(failureTimer);
      disposeLiveMap();
      mapboxModuleRef.current = null;
    };
  }, [mapboxToken, missions.length]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(jellyhuntMapStyle(theme));
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxModuleRef.current;
    if (!mapLoaded || !map || !mapboxgl) return;

    const visibleIds = new Set(filteredMissions.map((mission) => mission.id));
    mapMarkersRef.current.forEach(({ marker }, missionId) => {
      if (!visibleIds.has(missionId)) {
        marker.remove();
        mapMarkersRef.current.delete(missionId);
      }
    });

    const bounds = new mapboxgl.LngLatBounds();
    for (const mission of filteredMissions) {
      const missionStatus = missionState(mission.id, userStatus);
      const accent = missionAccent(mission);
      let entry = mapMarkersRef.current.get(mission.id);

      if (!entry) {
        const markerElement = document.createElement("div");
        markerElement.className = "hunt-mapbox-marker-anchor";
        const markerButton = document.createElement("button");
        markerButton.type = "button";
        markerButton.addEventListener("click", () => setSelectedId(mission.id));
        const markerLabel = document.createElement("span");
        markerLabel.setAttribute("aria-hidden", "true");
        const tooltip = document.createElement("small");
        tooltip.className = "hunt-marker-tooltip";
        markerElement.append(markerButton, tooltip);

        const marker = new mapboxgl.Marker({ element: markerElement, anchor: "bottom" })
          .setLngLat([mission.location.longitude, mission.location.latitude])
          .addTo(map);
        entry = { marker, button: markerButton, label: markerLabel, tooltip };
        markerButton.append(markerLabel);
        mapMarkersRef.current.set(mission.id, entry);
      }

      entry.marker.setLngLat([mission.location.longitude, mission.location.latitude]);
      entry.button.className = `hunt-mapbox-marker hunt-marker-${missionStatus}`;
      entry.button.dataset.selected = "false";
      entry.button.setAttribute("aria-label", `Open ${mission.title}`);
      entry.button.style.setProperty("--accent", accent);
      entry.label.textContent = isMissionComplete(missionStatus) ? "✓" : mission.emoji;
      entry.tooltip.textContent = mission.location.name;
      entry.tooltip.style.borderColor = accent;
      entry.tooltip.hidden = true;
      bounds.extend([mission.location.longitude, mission.location.latitude]);
    }

    if (filteredMissions.length > 1) {
      map.fitBounds(bounds, { padding: 100, maxZoom: 14, duration: 0 });
    } else if (filteredMissions.length === 1) {
      const only = filteredMissions[0];
      map.jumpTo({ center: [only.location.longitude, only.location.latitude], zoom: 14 });
    }
  }, [filteredMissions, mapLoaded, userStatus]);

  useEffect(() => {
    mapMarkersRef.current.forEach((entry, missionId) => {
      const selected = missionId === selectedId;
      entry.button.dataset.selected = String(selected);
      entry.button.setAttribute("aria-pressed", String(selected));
      entry.tooltip.hidden = !selected;
    });

    if (!selectedMission || !mapRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mapRef.current.flyTo({
      center: [selectedMission.location.longitude, selectedMission.location.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 13.5),
      duration: reduceMotion ? 0 : 550,
      essential: false,
    });
  }, [mapLoaded, selectedId, selectedMission]);

  useEffect(() => {
    if (!userLocation || !mapRef.current || !mapboxToken || !mapLoaded) return;

    let cancelled = false;
    void import("mapbox-gl").then((mapboxModule) => {
      if (cancelled || !mapRef.current) return;
      userMarkerRef.current?.remove();
      const element = document.createElement("div");
      element.className = "hunt-user-marker";
      element.setAttribute("aria-label", "Your location");
      userMarkerRef.current = new mapboxModule.default.Marker({ element })
        .setLngLat([userLocation.longitude, userLocation.latitude])
        .addTo(mapRef.current);
    });

    return () => {
      cancelled = true;
    };
  }, [mapLoaded, mapboxToken, userLocation]);

  useEffect(() => {
    if (!overlayOpen) return;
    const root = menuOpen ? menuRef.current : panelRef.current;
    if (!root) return;

    if (!lastFocusedRef.current && document.activeElement instanceof HTMLElement) {
      lastFocusedRef.current = document.activeElement;
    }

    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    window.requestAnimationFrame(() => (focusable[0] ?? root).focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (experiencePanel) setExperiencePanel(null);
        else setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    root.addEventListener("keydown", handleKeyDown);
    return () => root.removeEventListener("keydown", handleKeyDown);
  }, [experiencePanel, menuOpen, overlayOpen]);

  useEffect(() => {
    if (overlayOpen) return;
    const previous = lastFocusedRef.current;
    lastFocusedRef.current = null;
    if (previous?.isConnected) window.requestAnimationFrame(() => previous.focus());
  }, [overlayOpen]);

  function locateUser() {
    if (!navigator.geolocation) {
      setLocationMessage("Location is unavailable in this browser.");
      return;
    }

    setLocationMessage("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setUserLocation(location);
        setLocationMessage("You are on the map.");
        mapRef.current?.flyTo({
          center: [location.longitude, location.latitude],
          zoom: 14,
          duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 550,
          essential: false,
        });
      },
      (error) => {
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Turn on browser location to see what is nearby."
            : "We could not get your location. Try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    );
  }

  function zoomMap(direction: "in" | "out") {
    if (mapRef.current) {
      mapRef.current.zoomTo(mapRef.current.getZoom() + (direction === "in" ? 1 : -1));
      return;
    }
    setFallbackZoom((value) =>
      direction === "in" ? Math.min(1.8, value + 0.2) : Math.max(0.9, value - 0.2),
    );
  }

  function showPanel(panel: Exclude<ExperiencePanel, null>) {
    setMenuOpen(false);
    setExperiencePanel(panel);
  }

  function chooseMission(missionId: string) {
    setQuery("");
    setCategory("all");
    setStatus("all");
    setExperiencePanel(null);
    setMenuOpen(false);
    setFiltersOpen(false);
    setSelectedId(missionId);
  }

  const selectedState = selectedMission
    ? missionState(selectedMission.id, userStatus)
    : "not_started";
  const openState = selectedMission
    ? getMissionOpenState(
        selectedMission.hours,
        new Date(),
        selectedMission.location.timeZone,
      )
    : "unknown";
  const selectedDistance = selectedMission
    ? haversineDistanceMeters(userLocation ?? HQ, {
        latitude: selectedMission.location.latitude,
        longitude: selectedMission.location.longitude,
      })
    : null;
  const mapCenter = selectedMission
    ? {
        latitude: selectedMission.location.latitude,
        longitude: selectedMission.location.longitude,
      }
    : HQ;
  const mapboxActive =
    Boolean(mapboxToken) && missions.length > 0 && !mapFailed;

  return (
    <main className={`hunt-page hunt-map-screen hunt-theme-${theme}`}>
      <a className="hunt-skip-link" href="#jellyhunt-map">Skip to Mission Map</a>
      <section id="jellyhunt-map" className="hunt-map-stage" aria-label="Jellyhunt mission map" aria-hidden={overlayOpen ? true : undefined}>
        {mapboxActive ? (
          <div
            className={`hunt-mapbox${mapLoaded ? " is-loaded" : ""}`}
            ref={mapContainerRef}
            role="region"
            aria-label="Interactive Jellyhunt mission map"
          />
        ) : null}
        {!mapboxActive || !mapLoaded ? (
          <div className="hunt-fallback-map" role="region" aria-label="Interactive Jellyhunt coordinate map">
            <div
              className="hunt-fallback-layer"
              style={{ transform: `scale(${fallbackZoom})` }}
            >
              {EAST_WEST_STREETS.map((street) => (
                <div
                  className={`hunt-street hunt-street-ew${street.major ? " major" : ""}${street.spine ? " spine" : ""}`}
                  key={street.label}
                  style={{ top: `${projectCoordinates({ latitude: street.latitude, longitude: HQ.longitude }).top}%` }}
                  aria-hidden="true"
                >
                  <span>{street.label}</span><span>{street.label}</span><span>{street.label}</span>
                </div>
              ))}
              {NORTH_SOUTH_STREETS.map((street) => (
                <div
                  className={`hunt-street hunt-street-ns${street.major ? " major" : ""}`}
                  key={street.label}
                  style={{ left: `${projectCoordinates({ latitude: HQ.latitude, longitude: street.longitude }).left}%` }}
                  aria-hidden="true"
                >
                  <span>{street.label}</span><span>{street.label}</span><span>{street.label}</span>
                </div>
              ))}

              <div
                className="hunt-hq"
                style={{
                  left: `${projectCoordinates(HQ).left}%`,
                  top: `${projectCoordinates(HQ).top}%`,
                }}
              >
                <span className="hunt-hq-pulse" aria-hidden="true" />
                <Image src="/wobbles/wobble_product.png" alt="JellyJelly HQ" width={72} height={72} priority />
                <strong>JELLYJELLY HQ</strong>
              </div>

              {filteredMissions.map((mission) => {
                const position = projectCoordinates({
                  latitude: mission.location.latitude,
                  longitude: mission.location.longitude,
                });
                const missionStatus = missionState(mission.id, userStatus);
                const accent = missionAccent(mission);
                return (
                  <div
                    className="hunt-fallback-marker-anchor"
                    key={mission.id}
                    style={{ left: `${position.left}%`, top: `${position.top}%`, zIndex: mission.id === selectedMission?.id ? 6 : 3 }}
                  >
                    <button
                      type="button"
                      className={`hunt-fallback-marker hunt-marker-${missionStatus}`}
                      data-selected={mission.id === selectedMission?.id}
                      aria-pressed={mission.id === selectedMission?.id}
                      style={{ "--accent": accent } as CSSProperties}
                      onClick={() => setSelectedId(mission.id)}
                      aria-label={`Open ${mission.title}`}
                    >
                      <span aria-hidden="true">{isMissionComplete(missionStatus) ? "✓" : mission.emoji}</span>
                    </button>
                    {mission.id === selectedMission?.id ? (
                      <small className="hunt-marker-tooltip" style={{ borderColor: accent }}>{mission.location.name}</small>
                    ) : null}
                  </div>
                );
              })}

              {userLocation ? (
                <span
                  className="hunt-fallback-user"
                  style={{
                    left: `${projectCoordinates(userLocation).left}%`,
                    top: `${projectCoordinates(userLocation).top}%`,
                  }}
                  role="img"
                  aria-label="Your approximate location"
                />
              ) : null}
            </div>
          </div>
        ) : null}
        {mapboxActive && !mapLoaded ? (
          <div className="hunt-map-loading" role="status">
            <span aria-hidden="true" /> Loading live map…
          </div>
        ) : null}

        <header className="hunt-map-header">
          <div className="hunt-brand-lockup">
            <button
              className="hunt-menu-button"
              type="button"
              aria-label="Open Jellyhunt menu"
              aria-controls="hunt-menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={23} aria-hidden="true" />
            </button>
            <span className="hunt-brand-mark" aria-hidden="true">
              <Mic2 size={25} strokeWidth={2.4} />
            </span>
            <div className="hunt-brand-copy">
              <span className="hunt-partnership" translate="no">PlatePost x JellyJelly: Human Social!</span>
              <h1>JELLYHUNT</h1>
              <small><span>LOWER MANHATTAN</span><i />{Math.max(0, missions.length - completedCount)} MISSIONS OPEN</small>
            </div>
          </div>

          <div className="hunt-header-actions">
            <button
              type="button"
              aria-label="Find and filter missions"
              aria-controls="hunt-filters"
              aria-expanded={filtersOpen}
              data-active={filtersOpen}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
            </button>
            <a className="hunt-get-app" href={appLinks.ios} target="_blank" rel="noreferrer">
              Get JellyJelly <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <button type="button" aria-label="How Jellyhunt works" onClick={() => showPanel("how")}>
              <CircleHelp size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="hunt-cross-street" aria-live="polite">
          <span /> {nearestCrossStreet(mapCenter)}
        </div>

        {filtersOpen ? (
          <aside id="hunt-filters" className="hunt-filter-panel" aria-label="Filter missions">
            <div className="hunt-filter-heading">
              <div><strong>Find a mission</strong><span>{filteredMissions.length} on the map</span></div>
              <button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><X size={17} aria-hidden="true" /></button>
            </div>
            <label className="hunt-filter-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search missions</span>
              <input type="search" name="missionSearch" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Place, neighborhood, mission…" />
            </label>
            <div className="hunt-filter-selects">
              <label>
                <span>Category</span>
                <select name="missionCategory" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="all">All</option>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              {userStatus.length ? (
                <label>
                  <span>Status</span>
                  <select name="missionStatus" value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="all">All</option>
                    <option value="not_started">Available</option>
                    <option value="submitted">Submitted</option>
                    <option value="verifying">Verifying</option>
                    <option value="needs_review">Pending review</option>
                    <option value="approved">Mission complete</option>
                    <option value="rejected">Try again</option>
                    <option value="reward_queued">Reward queued</option>
                    <option value="reward_sent">Reward sent</option>
                    <option value="reward_failed">Reward issue</option>
                    <option value="reward_uncertain">Reward reconciling</option>
                  </select>
                </label>
              ) : null}
            </div>
            {filteredMissions.length ? (
              <nav className="hunt-filter-results" aria-label="Visible missions">
                {filteredMissions.map((mission) => (
                  <button key={mission.id} type="button" aria-pressed={mission.id === selectedMission?.id} onClick={() => { setSelectedId(mission.id); setFiltersOpen(false); }}>
                    <span aria-hidden="true">{mission.emoji}</span>
                    <strong>{mission.location.name}<small>{mission.neighborhood}</small></strong>
                    <i>+{mission.rewardAmount}</i>
                  </button>
                ))}
              </nav>
            ) : null}
                        {(query || category !== "all" || status !== "all") ? (
              <button className="hunt-clear-filters" type="button" onClick={() => { setQuery(""); setCategory("all"); setStatus("all"); }}>
                Clear filters
              </button>
            ) : null}
          </aside>
        ) : null}

        <div className={`hunt-zoom-controls${selectedMission ? " lifted" : ""}`}>
          <button type="button" aria-label="Zoom in" onClick={() => zoomMap("in")}><ZoomIn size={19} aria-hidden="true" /></button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomMap("out")}><ZoomOut size={19} aria-hidden="true" /></button>
          <button type="button" aria-label="Use my location" onClick={locateUser}><LocateFixed size={18} aria-hidden="true" /></button>
        </div>

        {locationMessage ? <div className="hunt-location-toast" role="status">{locationMessage}</div> : null}
        {dataError ? (
          <div className="hunt-data-notice" role="status">
            <strong>Mission updates paused.</strong>
            <span>{dataError}</span>
          </div>
        ) : null}
        {!filteredMissions.length && !dataError ? (
          <div className="hunt-no-results">
            <MapIcon size={22} aria-hidden="true" />
            <strong>{missions.length ? "No missions match." : "New missions are on the way."}</strong>
            {missions.length ? <button type="button" onClick={() => { setQuery(""); setCategory("all"); setStatus("all"); }}>Show all missions</button> : null}
          </div>
        ) : null}

        {selectedMission ? (
          <article className="hunt-detail-card" aria-live="polite" aria-labelledby="hunt-mission-title">
            <span className="hunt-drawer-handle" aria-hidden="true" />
            <button className="hunt-detail-close" type="button" onClick={() => setSelectedId(null)} aria-label="Close mission details">
              <X size={18} aria-hidden="true" />
            </button>
            <div className="hunt-detail-meta">
              <span>SELECTED · {selectedDistance === null ? "NEARBY" : `${formatDistance(selectedDistance)} FROM ${userLocation ? "YOU" : "HQ"}`}</span>
              <strong style={{ color: missionAccent(selectedMission) }}>{difficultyLabels[selectedMission.difficulty].toUpperCase()} MISSION</strong>
            </div>
            <div className="hunt-detail-grid">
              <div className="hunt-detail-venue">
                <div className="hunt-detail-row">
                  <span className="hunt-detail-emoji" style={{ borderColor: missionAccent(selectedMission) }} aria-hidden="true">{selectedMission.emoji}</span>
                  <div className="hunt-detail-title">
                    <h2 id="hunt-mission-title">{selectedMission.location.name}</h2>
                    <p><span style={{ color: missionAccent(selectedMission) }} aria-hidden="true">●</span> {selectedMission.location.address} · {selectedMission.neighborhood}</p>
                  </div>
                  <span className="hunt-reward-badge">
                    <small>REWARD</small>
                    <strong><i aria-hidden="true" /> {selectedMission.rewardAmount}<em> JMJ</em></strong>
                  </span>
                </div>
                <div className="hunt-detail-hours">
                  <strong data-open={openState === "open"}>{selectedMission.venueType === "shows" ? "• SHOWS" : openState === "open" ? "• OPEN" : "○ CLOSED"}</strong>
                  <span>{formatHours(selectedMission)}</span>
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedMission.location.latitude},${selectedMission.location.longitude}`} target="_blank" rel="noreferrer">Directions <Navigation size={14} aria-hidden="true" /></a>
                </div>
              </div>
              <div className="hunt-detail-mission">
                <span>YOUR MISSION</span>
                <p>{selectedMission.description}</p>
              </div>
            </div>
            {userStatus.find((item) => item.missionId === selectedMission.id)?.rejectionReason ? (
              <div className="hunt-rejection"><strong>Try again:</strong> {userStatus.find((item) => item.missionId === selectedMission.id)?.rejectionReason}</div>
            ) : null}
            {canStartMission(selectedState) ? (
              <a
                className={`hunt-start-mission hunt-start-${selectedState}`}
                href={`jellyjelly://camera?mission_id=${encodeURIComponent(selectedMission.id)}`}
                aria-label={`${missionStatusLabel(selectedState)} in JellyJelly`}
              >
                {missionStatusLabel(selectedState)}
              </a>
            ) : (
              <div className={`hunt-start-mission hunt-start-${selectedState}`} role="status" data-disabled="true">
                {missionStatusLabel(selectedState)}
              </div>
            )}
          </article>
        ) : null}

        <div className={`hunt-theme-toggle${selectedMission ? " lifted" : ""}`} role="group" aria-label="Map theme">
          <button type="button" aria-pressed={theme === "dark"} data-active={theme === "dark"} onClick={() => setTheme("dark")}>🌙 Dark</button>
          <button type="button" aria-pressed={theme === "wobbles"} data-active={theme === "wobbles"} onClick={() => setTheme("wobbles")}>🌊 Wobbles</button>
        </div>
      </section>

      {menuOpen ? (
        <>
          <button className="hunt-menu-overlay" type="button" aria-label="Close Jellyhunt menu" onClick={() => setMenuOpen(false)} />
          <aside id="hunt-menu" className="hunt-menu-panel" aria-label="Jellyhunt menu" role="dialog" aria-modal="true" tabIndex={-1} ref={menuRef}>
            <div className="hunt-menu-heading">
              <div><span>PlatePost × JellyJelly</span><strong>JELLYHUNT</strong></div>
              <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={22} aria-hidden="true" /></button>
            </div>
            <nav>
              <button type="button" aria-pressed="true" data-active="true" onClick={() => setMenuOpen(false)}><MapIcon size={20} aria-hidden="true" /><span>Map</span></button>
              <button type="button" onClick={() => showPanel("passport")}><Sparkles size={20} aria-hidden="true" /><span>Passport</span></button>
              <button type="button" onClick={() => showPanel("guide")}><Navigation size={20} aria-hidden="true" /><span>Editorial Map</span></button>
              <button type="button" onClick={() => showPanel("leaderboard")}><Trophy size={20} aria-hidden="true" /><span>Leaderboard</span></button>
              <button type="button" onClick={() => showPanel("how")}><CircleHelp size={20} aria-hidden="true" /><span>How It Works</span></button>
            </nav>
            <div className="hunt-menu-spacer" />
            <p>PlatePost x JellyJelly: Human Social!</p>
            <div className="hunt-menu-stores">
              <a href={appLinks.ios} target="_blank" rel="noreferrer"><Apple size={17} aria-hidden="true" /> iPhone</a>
              <a href={appLinks.android} target="_blank" rel="noreferrer"><Play size={17} aria-hidden="true" /> Android</a>
            </div>
          </aside>
        </>
      ) : null}

      {experiencePanel ? (
        <section className="hunt-experience-panel" aria-label={`${experiencePanel} view`} role="dialog" aria-modal="true" tabIndex={-1} ref={panelRef}>
          <header>
            <button type="button" aria-label="Back to map" onClick={() => setExperiencePanel(null)}><ArrowLeft size={20} aria-hidden="true" /></button>
            <div><span>PlatePost × JellyJelly</span><strong>JELLYHUNT</strong></div>
            <a href={appLinks.ios} target="_blank" rel="noreferrer">Get JellyJelly <ArrowUpRight size={14} aria-hidden="true" /></a>
          </header>

          {experiencePanel === "passport" ? (
            hasPersonalizedStatus ? (
              <div className="hunt-passport-view">
                <div className="hunt-panel-intro"><span>Your city passport</span><h1>{completedCount}/{missions.length} places found.</h1><p>Completed and rewarded missions become stamps across JellyJelly and the PlatePost map.</p></div>
                <div className="hunt-passport-progress"><span style={{ width: `${missions.length ? (completedCount / missions.length) * 100 : 0}%` }} /></div>
                <div className="hunt-passport-grid">
                  {missions.map((mission, index) => {
                    const missionStatus = missionState(mission.id, userStatus);
                    const stamped = isMissionComplete(missionStatus);
                    return <button key={mission.id} type="button" data-stamped={stamped} onClick={() => chooseMission(mission.id)}><small>{String(index + 1).padStart(2, "0")}</small><strong>{stamped ? mission.emoji : "?"}</strong><span>{mission.location.name}</span>{stamped ? <i>✓</i> : null}</button>;
                  })}
                </div>
              </div>
            ) : (
              <div className="hunt-coming-view hunt-passport-connect">
                <Sparkles size={42} aria-hidden="true" />
                <span>City passport</span>
                <h1>Your passport lives in JellyJelly.</h1>
                <p>Open JellyJelly to start a mission and keep your personal progress connected. The public PlatePost map never guesses or exposes a visitor’s account.</p>
                <div><a href={appLinks.ios} target="_blank" rel="noreferrer"><Apple size={18} aria-hidden="true" /> Open on iPhone</a><a href={appLinks.android} target="_blank" rel="noreferrer"><Play size={18} aria-hidden="true" /> Open on Android</a></div>
              </div>
            )
          ) : null}

          {experiencePanel === "guide" ? (
            <div className="hunt-guide-view">
              <div className="hunt-panel-intro"><span>Editorial map</span><h1>{missions.length} reasons to go outside.</h1><p>A living guide to local places, playful prompts, and real moments worth sharing.</p></div>
              <label className="hunt-guide-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search mission guide</span><input type="search" name="guideSearch" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the guide…" /></label>
              <div className="hunt-guide-grid">
                {filteredMissions.map((mission, index) => <button key={mission.id} type="button" onClick={() => chooseMission(mission.id)}><small>STOP {String(index + 1).padStart(2, "0")} · {mission.neighborhood}</small><strong><span>{mission.emoji}</span>{mission.location.name}</strong><p>{mission.description}</p><i>+{mission.rewardAmount} JMJ</i></button>)}
              </div>
            </div>
          ) : null}

          {experiencePanel === "leaderboard" ? (
            <div className="hunt-leaderboard-view">
              <div className="hunt-panel-intro hunt-leaderboard-intro">
                <span>Most approved</span>
                <h1>Real people. Real city.</h1>
                <p>Ranked by missions PlatePost has approved. Only public Jelly usernames appear here.</p>
              </div>
              <div className="hunt-leaderboard-tabs" role="tablist" aria-label="Leaderboard timeframe">
                <button
                  type="button"
                  role="tab"
                  aria-selected={leaderboardScope === "current-season"}
                  data-active={leaderboardScope === "current-season"}
                  onClick={() => setLeaderboardScope("current-season")}
                >
                  Current season
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={leaderboardScope === "all-time"}
                  data-active={leaderboardScope === "all-time"}
                  onClick={() => setLeaderboardScope("all-time")}
                >
                  All time
                </button>
              </div>
              <section
                className="hunt-leaderboard-board"
                aria-live="polite"
                aria-busy={activeLeaderboard.status === "loading"}
              >
                {activeLeaderboard.status === "idle" || activeLeaderboard.status === "loading" ? (
                  <div className="hunt-leaderboard-loading" role="status">
                    <span>Loading approved missions…</span>
                    {[0, 1, 2, 3, 4].map((row) => <i key={row} />)}
                  </div>
                ) : null}
                {activeLeaderboard.status === "error" ? (
                  <div className="hunt-leaderboard-message" role="alert">
                    <Trophy size={30} aria-hidden="true" />
                    <strong>Rankings could not load.</strong>
                    <p>PlatePost kept the map open. Try the ranking again.</p>
                    <button type="button" onClick={() => setLeaderboardReload((value) => value + 1)}>Try again</button>
                  </div>
                ) : null}
                {activeLeaderboard.status === "ready" && activeLeaderboard.standings.length === 0 ? (
                  <div className="hunt-leaderboard-message">
                    <Trophy size={30} aria-hidden="true" />
                    <strong>No approved missions yet.</strong>
                    <p>The first approved Jelly takes the top spot.</p>
                  </div>
                ) : null}
                {activeLeaderboard.status === "ready" && activeLeaderboard.standings.length > 0 ? (
                  <ol
                    className="hunt-leaderboard-list"
                    aria-label={(leaderboardScope === "current-season" ? "Current season" : "All time") + " most approved"}
                  >
                    {activeLeaderboard.standings.map((standing) => (
                      <li key={String(standing.rank) + ":" + standing.username} data-podium={standing.rank <= 3}>
                        <span className="hunt-leaderboard-rank">{String(standing.rank).padStart(2, "0")}</span>
                        <strong>@{standing.username}</strong>
                        <span className="hunt-leaderboard-score">
                          {standing.approvedMissionCount}
                          <small>approved</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
              <p className="hunt-leaderboard-note">Ties share a rank. Scores update after mission approval or reversal.</p>
            </div>
          ) : null}

          {experiencePanel === "how" ? (
            <div className="hunt-how-view">
              <div className="hunt-panel-intro"><span>Human Social!</span><h1>Go somewhere. Meet someone. Share the moment.</h1></div>
              <div className="hunt-how-grid">
                <article><b>01</b><MapIcon size={28} aria-hidden="true" /><h2>Pick a place</h2><p>Choose a live mission on the map and check the venue details.</p></article>
                <article><b>02</b><Sparkles size={28} aria-hidden="true" /><h2>Make a Jelly</h2><p>Visit the location, complete the prompt, and post the real moment in JellyJelly.</p></article>
                <article><b>03</b><Trophy size={28} aria-hidden="true" /><h2>Earn after review</h2><p>PlatePost verifies the mission. Jelly sends the final Jelly-My-Jelly reward.</p></article>
              </div>
              <div className="hunt-how-apps"><a href={appLinks.ios} target="_blank" rel="noreferrer"><Apple size={18} aria-hidden="true" /> Get JellyJelly for iPhone</a><a href={appLinks.android} target="_blank" rel="noreferrer"><Play size={18} aria-hidden="true" /> Get JellyJelly for Android</a></div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
