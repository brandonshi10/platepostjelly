import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page">
      <section className="page-header">
        <div>
          <div className="eyebrow">Jellyhunt operations</div>
          <h1>Editable missions, live map data, and a clean API for JellyJelly.</h1>
          <p>
            PlatePost hosts Jellyhunt mission operations in Convex while Jelly API
            remains the source for users, posts, location proof, and tipping.
          </p>
        </div>
        <Link className="button" href="/admin">Open Admin</Link>
      </section>
      <section className="metric-row">
        <div className="metric"><strong>Convex</strong><p>Missions, locations, submissions, dedupe, and audit state.</p></div>
        <div className="metric"><strong>Jelly API</strong><p>Users, posts, and tipping today; trusted restaurant and location proof after the partner contract.</p></div>
        <div className="metric"><strong>Admin</strong><p>Mission editing and completion review from PlatePost.</p></div>
        <div className="metric"><strong>Native</strong><p>Stable endpoints for Kris to build the JellyJelly map.</p></div>
      </section>
    </main>
  );
}
