import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE } from "@/src/lib/jellyhunt/admin-auth";
import {
  adminEnvironmentConfigured,
  readAdminSession,
} from "@/src/lib/jellyhunt/admin-server";
import { AdminDashboard } from "./admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const session = readAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (session) return <AdminDashboard username={session.username} />;

  const { error } = await searchParams;
  const configured = adminEnvironmentConfigured();

  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <span className="admin-kicker">PlatePost mission control</span>
        <h1>Sign in to run Jellyhunt.</h1>
        <p>Manage the live map, review Jelly proof, and keep rewards accountable.</p>
        {!configured || error === "configuration" ? (
          <div className="admin-login-error" role="alert">
            Admin access is not configured. Add the three Jellyhunt admin environment variables before signing in.
          </div>
        ) : error === "invalid" ? (
          <div className="admin-login-error" role="alert">The username or password did not match.</div>
        ) : null}
        <form action="/api/v1/jellyhunt/admin/session" method="post">
          <label>Username<input autoComplete="username" name="username" required /></label>
          <label>Password<input autoComplete="current-password" name="password" required type="password" /></label>
          <button type="submit" disabled={!configured}>Sign in</button>
        </form>
        <small>Credentials stay on the server. This browser receives only a signed, HTTP-only session.</small>
      </section>
      <aside className="admin-login-aside" aria-label="Jellyhunt workflow">
        <span>Mission flow</span>
        <ol>
          <li><b>01</b> Set the place and challenge</li>
          <li><b>02</b> Publish to the Human Social map</li>
          <li><b>03</b> Review verified Jelly proof</li>
          <li><b>04</b> Record one reward</li>
        </ol>
      </aside>
    </main>
  );
}
