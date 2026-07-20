import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function collectRoutes(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? collectRoutes(absolute) : entry.name === "route.ts" ? [absolute] : [];
  });
}

describe("JellyHunt v2 route module resolution", () => {
  it("uses the repository's src-root alias for every shared v2 import", () => {
    const routes = collectRoutes(path.resolve("app/api/v2/jellyhunt"));
    expect(routes).toHaveLength(17);

    for (const route of routes) {
      const source = fs.readFileSync(route, "utf8");
      expect(source, route).not.toMatch(/from ["']@\/lib\//);
    }
  });
});