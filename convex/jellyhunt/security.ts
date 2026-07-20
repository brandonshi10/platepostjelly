/**
 * Server-only authorization guard for JellyHunt admin/service Convex
 * mutations. Every namespaced admin mutation in `convex/jellyhunt/*.ts`
 * calls this before touching the database.
 *
 * The comparison is constant-time in the number of characters actually
 * compared so a timing side-channel cannot be used to guess
 * `PLATEPOST_CONVEX_SERVICE_KEY` one byte at a time. A length mismatch is
 * rejected before the loop (an attacker already learns nothing new from
 * that: differing lengths are the cheapest possible failure and comparing
 * further would not make the check safer).
 */
export function requireServiceKey(provided: string): void {
  const expected = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
  if (!expected || provided.length !== expected.length) throw new Error("unauthorized");
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  if (mismatch !== 0) throw new Error("unauthorized");
}
