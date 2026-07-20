import type { Metadata } from "next";
import Link from "next/link";
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "PlatePost Jellyhunt",
  description: "Editable Jellyhunt missions and map API hosted by PlatePost.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">PlatePost Jellyhunt</Link>
            <nav className="nav" aria-label="Primary navigation">
              <Link href="/human-social">Human Social</Link>
              <Link href="/admin">Admin</Link>
              <Link href="/api/v1/jellyhunt/missions">API</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
