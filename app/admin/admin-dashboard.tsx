"use client";

import {
  Activity,
  Check,
  Edit3,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { formatMissionDateTime, parseMissionDateTime } from "@/src/lib/jellyhunt/admin-time";
import { useCallback, useEffect, useMemo, useState } from "react";

type LocationRecord = {
  _id: string;
  name: string;
  address?: string;
  jellyRestaurantId?: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  timeZone: string;
};

type MissionRecord = {
  _id: string;
  slug: string;
  title: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  approvalMode: "manual" | "automatic";
  restaurantTag: string;
  rewardAmount: number;
  category: string;
  difficulty: "easy" | "medium" | "hard" | "legendary";
  emoji: string;
  neighborhood: string;
  price: string;
  hours: string[];
  venueType?: string;
  showtimes?: string[];
  sortOrder: number;
  websiteUrl?: string;
  startsAt?: number;
  endsAt?: number;
  location: LocationRecord | null;
};

type SubmissionRecord = {
  _id: string;
  jellyUserId: string;
  jellyPostId: string;
  status: string;
  createdAt: number;
  verificationSummary?: string;
  rejectionReason?: string;
  rewardTransactionId?: string;
  missionTitleSnapshot?: string;
  locationNameSnapshot?: string;
  restaurantTagSnapshot?: string;
  jellyRestaurantIdSnapshot?: string;
  rewardAmountSnapshot?: number;
  claimedLatitude?: number;
  claimedLongitude?: number;
  verifiedLatitude?: number;
  verifiedLongitude?: number;
  distanceMeters?: number;
  mission: MissionRecord | null;
  location: LocationRecord | null;
  rewardAttempt?: { status: string; error?: string };
};

type AuditRecord = {
  _id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  nextState?: string;
  createdAt: number;
};

type Draft = {
  missionId: string;
  locationId: string;
  title: string;
  slug: string;
  description: string;
  status: MissionRecord["status"];
  approvalMode: MissionRecord["approvalMode"];
  restaurantTag: string;
  rewardAmount: string;
  category: string;
  difficulty: MissionRecord["difficulty"];
  emoji: string;
  neighborhood: string;
  price: string;
  hours: string[];
  venueType: string;
  showtimes: string;
  sortOrder: string;
  websiteUrl: string;
  startsAt: string;
  endsAt: string;
  locationName: string;
  address: string;
  jellyRestaurantId: string;
  latitude: string;
  longitude: string;
  geofenceRadiusMeters: string;
  timeZone: string;
};

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function emptyDraft(): Draft {
  return {
    missionId: "",
    locationId: "",
    title: "",
    slug: "",
    description: "",
    status: "draft",
    approvalMode: "manual",
    restaurantTag: "",
    rewardAmount: "100",
    category: "Food",
    difficulty: "easy",
    emoji: "🍽️",
    neighborhood: "",
    price: "$$",
    hours: Array.from({ length: 7 }, () => "09:00-22:00"),
    venueType: "restaurant",
    showtimes: "",
    sortOrder: "0",
    websiteUrl: "",
    startsAt: "",
    endsAt: "",
    locationName: "",
    address: "",
    jellyRestaurantId: "",
    latitude: "",
    longitude: "",
    geofenceRadiusMeters: "100",
    timeZone: "America/New_York",
  };
}

function toDraft(mission: MissionRecord): Draft {
  const location = mission.location;
  return {
    ...emptyDraft(),
    missionId: mission._id,
    locationId: location?._id ?? "",
    title: mission.title,
    slug: mission.slug,
    description: mission.description,
    status: mission.status,
    approvalMode: mission.approvalMode,
    restaurantTag: mission.restaurantTag,
    rewardAmount: String(mission.rewardAmount),
    category: mission.category,
    difficulty: mission.difficulty,
    emoji: mission.emoji,
    neighborhood: mission.neighborhood,
    price: mission.price,
    hours: mission.hours,
    venueType: mission.venueType ?? "",
    showtimes: mission.showtimes?.join(", ") ?? "",
    sortOrder: String(mission.sortOrder),
    websiteUrl: mission.websiteUrl ?? "",
    startsAt: formatMissionDateTime(mission.startsAt, location?.timeZone ?? "America/New_York"),
    endsAt: formatMissionDateTime(mission.endsAt, location?.timeZone ?? "America/New_York"),
    locationName: location?.name ?? "",
    address: location?.address ?? "",
    jellyRestaurantId: location?.jellyRestaurantId ?? "",
    latitude: location ? String(location.latitude) : "",
    longitude: location ? String(location.longitude) : "",
    geofenceRadiusMeters: location ? String(location.geofenceRadiusMeters) : "100",
    timeZone: location?.timeZone ?? "America/New_York",
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    if (response.status === 401) window.location.reload();
    throw new Error(body.error?.message ?? "The admin request could not be completed.");
  }
  return body;
}

const stateLabel = (status: string) => status.replaceAll("_", " ");

export function AdminDashboard({ username }: { username: string }) {
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [events, setEvents] = useState<AuditRecord[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [tab, setTab] = useState<"missions" | "reviews" | "activity">("missions");
  const [filter, setFilter] = useState("all");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [transactionIds, setTransactionIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [missionData, submissionData, auditData] = await Promise.all([
        requestJson<{ missions: MissionRecord[] }>("/api/v1/jellyhunt/admin/missions"),
        requestJson<{ submissions: SubmissionRecord[] }>("/api/v1/jellyhunt/admin/submissions?status=all"),
        requestJson<{ events: AuditRecord[] }>("/api/v1/jellyhunt/admin/audit").catch(() => ({ events: [] })),
      ]);
      setMissions(missionData.missions);
      setSubmissions(submissionData.submissions);
      setEvents(auditData.events);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Jellyhunt data could not be loaded." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleSubmissions = useMemo(
    () => submissions.filter((submission) => filter === "all" || submission.status === filter),
    [filter, submissions],
  );
  const reviewCount = submissions.filter((submission) => submission.status === "needs_review").length;
  const activeCount = missions.filter((mission) => mission.status === "active").length;
  const exceptionCount = submissions.filter((submission) => ["reward_failed", "reward_uncertain"].includes(submission.status)).length;

  function set<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function payload() {
    const showtimes = draft.showtimes.split(",").map((value) => value.trim()).filter(Boolean);
    return {
      mission: {
        slug: draft.slug,
        title: draft.title,
        description: draft.description,
        status: draft.status,
        approvalMode: draft.approvalMode,
        restaurantTag: draft.restaurantTag,
        rewardAmount: Number(draft.rewardAmount),
        category: draft.category,
        difficulty: draft.difficulty,
        emoji: draft.emoji,
        neighborhood: draft.neighborhood,
        price: draft.price,
        hours: draft.hours,
        venueType: draft.venueType || undefined,
        showtimes: showtimes.length ? showtimes : undefined,
        sortOrder: Number(draft.sortOrder),
        websiteUrl: draft.websiteUrl || undefined,
        startsAt: parseMissionDateTime(draft.startsAt, draft.timeZone),
        endsAt: parseMissionDateTime(draft.endsAt, draft.timeZone),
      },
      location: {
        name: draft.locationName,
        address: draft.address || undefined,
        jellyRestaurantId: draft.jellyRestaurantId || undefined,
        latitude: Number(draft.latitude),
        longitude: Number(draft.longitude),
        geofenceRadiusMeters: Number(draft.geofenceRadiusMeters),
        timeZone: draft.timeZone,
      },
    };
  }

  async function saveMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await requestJson("/api/v1/jellyhunt/admin/missions", {
        method: draft.missionId ? "PUT" : "POST",
        body: JSON.stringify({
          ...payload(),
          ...(draft.missionId ? { missionId: draft.missionId, locationId: draft.locationId } : {}),
        }),
      });
      setNotice({ type: "success", text: draft.missionId ? "Mission changes saved." : "Mission created." });
      setDraft(emptyDraft());
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Mission could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(missionId: string, status: MissionRecord["status"]) {
    try {
      await requestJson("/api/v1/jellyhunt/admin/missions", {
        method: "PATCH",
        body: JSON.stringify({ missionId, status }),
      });
      setNotice({ type: "success", text: `Mission moved to ${stateLabel(status)}.` });
      setDraft((current) => current.missionId === missionId ? { ...current, status } : current);
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Mission status could not be changed." });
    }
  }

  async function review(submissionId: string, action: string) {
    if (
      action === "approve" &&
      !window.confirm("Approve this verified submission and queue its Jelly reward?")
    ) return;
    try {
      await requestJson("/api/v1/jellyhunt/admin/submissions", {
        method: "PATCH",
        body: JSON.stringify({
          submissionId,
          action,
          reason: ["reject", "reconcile_reward_failed"].includes(action) ? reasons[submissionId] : undefined,
          transactionId: action === "reconcile_reward_sent" ? transactionIds[submissionId] : undefined,
        }),
      });
      setNotice({ type: "success", text: "Submission updated." });
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Submission could not be updated." });
    }
  }

  async function signOut() {
    await fetch("/api/v1/jellyhunt/admin/session", { method: "DELETE" });
    window.location.href = "/admin";
  }

  return (
    <main className="admin-page">
      <header className="admin-masthead">
        <div>
          <span className="admin-kicker">PlatePost mission control</span>
          <h1>Jellyhunt operations</h1>
          <p>Publish missions, review proof, and follow each reward from one place.</p>
        </div>
        <div className="admin-account">
          <span>Signed in as <strong>{username}</strong></span>
          <button type="button" onClick={() => void signOut()}><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      <section className="admin-state-rail" aria-label="Jellyhunt workflow">
        <span><b>1</b> Draft</span><i>→</i><span><b>2</b> Live on map</span><i>→</i>
        <span><b>3</b> Review proof</span><i>→</i><span><b>4</b> Reward recorded</span>
      </section>

      <section className="admin-metrics" aria-label="Jellyhunt overview">
        <article><strong>{activeCount}</strong><span>Live missions</span></article>
        <article><strong>{reviewCount}</strong><span>Waiting for review</span></article>
        <article><strong>{exceptionCount}</strong><span>Reward exceptions</span></article>
        <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /> Refresh</button>
      </section>

      <nav className="admin-tabs" aria-label="Admin sections">
        <button data-active={tab === "missions"} onClick={() => setTab("missions")}>Missions <span>{missions.length}</span></button>
        <button data-active={tab === "reviews"} onClick={() => setTab("reviews")}>Review queue <span>{reviewCount}</span></button>
        <button data-active={tab === "activity"} onClick={() => setTab("activity")}>Activity</button>
      </nav>

      {notice ? <div className={`admin-notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>{notice.text}</div> : null}

      {tab === "missions" ? (
        <div className="admin-mission-layout">
          <section className="admin-list-panel">
            <div className="admin-panel-head">
              <div><span>Mission library</span><strong>Choose a mission to edit</strong></div>
              <button type="button" onClick={() => setDraft(emptyDraft())}><Plus size={15} /> New</button>
            </div>
            {loading ? <div className="admin-empty">Loading missions…</div> : missions.length ? (
              <div className="admin-mission-stack">
                {missions.map((mission) => (
                  <article className="admin-mission-ticket" data-selected={draft.missionId === mission._id} key={mission._id}>
                    <button className="admin-ticket-main" type="button" onClick={() => setDraft(toDraft(mission))}>
                      <span className="admin-ticket-emoji">{mission.emoji}</span>
                      <span><strong>{mission.title}</strong><small><MapPin size={12} /> {mission.location?.name ?? "Location missing"}</small></span>
                      <Edit3 size={15} />
                    </button>
                    <div className="admin-ticket-foot">
                      <span className={`admin-state ${mission.status}`}>{stateLabel(mission.status)}</span>
                      <span>{mission.rewardAmount} JELLY</span>
                      <select aria-label={`Change ${mission.title} status`} value={mission.status} onChange={(event) => void changeStatus(mission._id, event.target.value as MissionRecord["status"])}>
                        <option value="draft">Draft</option><option value="active">Live</option>
                        <option value="paused">Paused</option><option value="archived">Archived</option>
                      </select>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="admin-empty"><MapPin size={25} /><strong>No missions yet</strong><span>Create the first mission and leave it as a draft until it is ready.</span><button onClick={() => setDraft(emptyDraft())}>Create mission</button></div>
            )}
          </section>

          <form className="admin-editor" onSubmit={(event) => void saveMission(event)}>
            <div className="admin-panel-head">
              <div><span>{draft.missionId ? "Edit mission" : "New mission"}</span><strong>{draft.title || "Untitled mission"}</strong></div>
              {draft.missionId ? <button type="button" onClick={() => setDraft(emptyDraft())}><X size={15} /> Close</button> : null}
            </div>

            <fieldset>
              <legend>What people see</legend>
              <div className="admin-form-grid">
                <label className="wide">Mission title<input required value={draft.title} onChange={(event) => set("title", event.target.value)} /></label>
                <label>URL name<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.slug} onChange={(event) => set("slug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /></label>
                <label>Emoji<input required value={draft.emoji} onChange={(event) => set("emoji", event.target.value)} /></label>
                <label className="wide">Instructions<textarea required value={draft.description} onChange={(event) => set("description", event.target.value)} /></label>
                <label>Category<input required value={draft.category} onChange={(event) => set("category", event.target.value)} /></label>
                <label>Neighborhood<input value={draft.neighborhood} onChange={(event) => set("neighborhood", event.target.value)} /></label>
                <label>Difficulty<select value={draft.difficulty} onChange={(event) => set("difficulty", event.target.value as Draft["difficulty"])}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="legendary">Legendary</option></select></label>
                <label>Price marker<input value={draft.price} onChange={(event) => set("price", event.target.value)} /></label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Location and proof</legend>
              <div className="admin-form-grid">
                <label className="wide">Location name<input required value={draft.locationName} onChange={(event) => set("locationName", event.target.value)} /></label>
                <label className="wide">Address<input value={draft.address} onChange={(event) => set("address", event.target.value)} /></label>
                <label>Latitude<input required type="number" min="-90" max="90" step="any" value={draft.latitude} onChange={(event) => set("latitude", event.target.value)} /></label>
                <label>Longitude<input required type="number" min="-180" max="180" step="any" value={draft.longitude} onChange={(event) => set("longitude", event.target.value)} /></label>
                <label>Geofence (meters)<input required type="number" min="1" step="1" value={draft.geofenceRadiusMeters} onChange={(event) => set("geofenceRadiusMeters", event.target.value)} /></label>
                <label>Time zone<input required value={draft.timeZone} onChange={(event) => set("timeZone", event.target.value)} /></label>
                <label>Restaurant tag<input required value={draft.restaurantTag} onChange={(event) => set("restaurantTag", event.target.value)} /></label>
                <label>Jelly restaurant ID<input value={draft.jellyRestaurantId} onChange={(event) => set("jellyRestaurantId", event.target.value)} /></label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Hours and schedule <small>({draft.timeZone})</small></legend>
              <div className="admin-hours-grid">
                {days.map((day, index) => <label key={day}>{day}<input required value={draft.hours[index] ?? "closed"} onChange={(event) => set("hours", draft.hours.map((value, i) => i === index ? event.target.value : value))} placeholder="09:00-22:00 or closed" /></label>)}
              </div>
              <div className="admin-form-grid compact">
                <label>Starts<input type="datetime-local" value={draft.startsAt} onChange={(event) => set("startsAt", event.target.value)} /></label>
                <label>Ends<input type="datetime-local" value={draft.endsAt} onChange={(event) => set("endsAt", event.target.value)} /></label>
                <label>Venue type<input value={draft.venueType} onChange={(event) => set("venueType", event.target.value)} /></label>
                <label>Showtimes<input value={draft.showtimes} onChange={(event) => set("showtimes", event.target.value)} placeholder="19:30, 21:00" /></label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Reward and publishing</legend>
              <div className="admin-form-grid compact">
                <label>Reward amount<input required type="number" min="1" value={draft.rewardAmount} onChange={(event) => set("rewardAmount", event.target.value)} /></label>
                <label>Approval<select value={draft.approvalMode} onChange={(event) => set("approvalMode", event.target.value as Draft["approvalMode"])}><option value="manual">Manual review</option><option value="automatic">Automatic after verification</option></select></label>
                <label>Map state<select value={draft.status} onChange={(event) => set("status", event.target.value as Draft["status"])}><option value="draft">Draft</option><option value="active">Live</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
                <label>Sort order<input required type="number" min="0" value={draft.sortOrder} onChange={(event) => set("sortOrder", event.target.value)} /></label>
                <label className="wide">Website URL<input type="url" value={draft.websiteUrl} onChange={(event) => set("websiteUrl", event.target.value)} /></label>
              </div>
            </fieldset>

            <div className="admin-editor-actions">
              <span>{draft.status === "active" ? "Saving updates the public map." : "Only live missions appear on the public map."}</span>
              <button className="admin-primary" type="submit" disabled={saving}><Save size={17} /> {saving ? "Saving…" : draft.missionId ? "Save changes" : "Create mission"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {tab === "reviews" ? (
        <section className="admin-review-panel">
          <div className="admin-panel-head">
            <div><span>Proof and rewards</span><strong>Submission review queue</strong></div>
            <select aria-label="Filter submissions" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All statuses</option><option value="needs_review">Needs review</option>
              <option value="reward_failed">Reward failed</option><option value="reward_uncertain">Reward uncertain</option>
              <option value="reward_sent">Reward sent</option><option value="rejected">Rejected</option>
            </select>
          </div>
          {loading ? <div className="admin-empty">Loading submissions…</div> : visibleSubmissions.length ? (
            <div className="admin-review-stack">
              {visibleSubmissions.map((submission) => (
                <article className="admin-review-card" key={submission._id}>
                  <div className="admin-review-summary">
                    <span className="admin-ticket-emoji">{submission.mission?.emoji ?? "📍"}</span>
                    <div><strong>{submission.missionTitleSnapshot ?? submission.mission?.title ?? "Mission unavailable"}</strong><small>{submission.locationNameSnapshot ?? submission.location?.name ?? "Location unavailable"} · Jelly user {submission.jellyUserId}</small><small>Post {submission.jellyPostId} · {new Date(submission.createdAt).toLocaleString()}</small></div>
                    <span className={`admin-state ${submission.status}`}>{stateLabel(submission.status)}</span>
                  </div>
<div className="admin-evidence">
                    <a href={`https://jellyjelly.com/watch/${encodeURIComponent(submission.jellyPostId)}`} target="_blank" rel="noreferrer">Open Jelly post ↗</a>
                    <span>Restaurant proof: {submission.restaurantTagSnapshot ? `#${submission.restaurantTagSnapshot}` : "tag unavailable"}{submission.jellyRestaurantIdSnapshot ? ` · ${submission.jellyRestaurantIdSnapshot}` : ""}</span>
                    <span>Claimed GPS: {submission.claimedLatitude !== undefined && submission.claimedLongitude !== undefined ? `${submission.claimedLatitude.toFixed(5)}, ${submission.claimedLongitude.toFixed(5)}` : "not supplied"}</span>
                    <span>Verified GPS: {submission.verifiedLatitude !== undefined && submission.verifiedLongitude !== undefined ? `${submission.verifiedLatitude.toFixed(5)}, ${submission.verifiedLongitude.toFixed(5)}` : "not available"}</span>
                    <span>Distance: {submission.distanceMeters !== undefined ? `${Math.round(submission.distanceMeters)} m from mission` : "not available"}</span>
                  </div>
                  {submission.verificationSummary ? <p className="admin-proof">{submission.verificationSummary}</p> : <p className="admin-proof">No verification summary was returned. Review the Jelly post and location evidence before deciding.</p>}
                  {submission.rejectionReason ? <p className="admin-proof error">Rejected: {submission.rejectionReason}</p> : null}
                  {submission.rewardAttempt?.error ? <p className="admin-proof error">Reward service: {submission.rewardAttempt.error}</p> : null}
                  <div className="admin-review-actions">
                    {submission.status === "needs_review" ? <>
                      <button className="approve" onClick={() => void review(submission._id, "approve")}><Check size={15} /> Approve + {submission.rewardAmountSnapshot ?? submission.mission?.rewardAmount ?? "?"} JELLY</button>
                      <label>Reason to reject<input value={reasons[submission._id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [submission._id]: event.target.value }))} /></label>
                      <button className="reject" disabled={!reasons[submission._id]?.trim()} onClick={() => void review(submission._id, "reject")}><X size={15} /> Reject</button>
                    </> : null}
                    {submission.status === "rejected" ? <span className="admin-caution">Rejected proof must be verified again before it can be approved.</span> : null}
                    {["submitted", "verifying", "needs_review", "rejected"].includes(submission.status) ? <button onClick={() => void review(submission._id, "retry_verification")}><RotateCcw size={15} /> Verify again</button> : null}
                    {submission.status === "reward_failed" ? <button onClick={() => void review(submission._id, "retry_reward")}><RefreshCw size={15} /> Retry confirmed failure</button> : null}
                    {submission.status === "reward_uncertain" ? <div className="admin-reconcile"><span className="admin-caution">Reconcile with Jelly before allowing any retry.</span><label>Jelly transaction ID<input value={transactionIds[submission._id] ?? ""} onChange={(event) => setTransactionIds((current) => ({ ...current, [submission._id]: event.target.value }))} /></label><button disabled={!transactionIds[submission._id]?.trim()} onClick={() => void review(submission._id, "reconcile_reward_sent")}><Check size={15} /> Mark sent</button><label>Confirmed failure reason<input value={reasons[submission._id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [submission._id]: event.target.value }))} /></label><button disabled={!reasons[submission._id]?.trim()} onClick={() => void review(submission._id, "reconcile_reward_failed")}><X size={15} /> Mark failed</button></div> : null}
                    {submission.rewardTransactionId ? <span className="admin-transaction">Transaction {submission.rewardTransactionId}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="admin-empty"><Check size={25} /><strong>Nothing in this view</strong><span>New Jelly submissions will appear here after verification.</span></div>}
        </section>
      ) : null}

      {tab === "activity" ? (
        <section className="admin-activity-panel">
          <div className="admin-panel-head"><div><span>Audit trail</span><strong>Recent Jellyhunt activity</strong></div><Activity size={20} /></div>
          {events.length ? <ol className="admin-activity-list">{events.map((event) => <li key={event._id}><span>{new Date(event.createdAt).toLocaleString()}</span><strong>{event.action.replaceAll(".", " ")}</strong><small>{event.actor} · {event.entityType} {event.entityId}{event.nextState ? ` → ${stateLabel(event.nextState)}` : ""}</small></li>)}</ol> : <div className="admin-empty"><Activity size={25} /><strong>No activity recorded yet</strong><span>Mission edits and review decisions will be logged here.</span></div>}
        </section>
      ) : null}
    </main>
  );
}
