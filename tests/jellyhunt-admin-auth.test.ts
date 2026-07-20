import { describe, expect, it } from "vitest";

type AdminAuthModule = {
  createAdminSession: (username: string, secret: string, now?: number) => string;
  verifyAdminSession: (
    token: string | null | undefined,
    secret: string | null | undefined,
    maxAgeMs?: number,
    now?: number,
  ) => { username: string; issuedAt: number } | null;
};

async function loadAdminAuth(): Promise<Partial<AdminAuthModule>> {
  const modulePath = "../src/lib/jellyhunt/admin-auth";
  try {
    return (await import(modulePath)) as AdminAuthModule;
  } catch {
    return {};
  }
}

describe("Jellyhunt admin sessions", () => {
  it("round-trips a signed admin session", async () => {
    const auth = await loadAdminAuth();
    expect(auth.createAdminSession).toBeTypeOf("function");
    expect(auth.verifyAdminSession).toBeTypeOf("function");

    const issuedAt = Date.UTC(2026, 6, 15, 12);
    const token = auth.createAdminSession!("platepost-admin", "session-secret", issuedAt);

    expect(
      auth.verifyAdminSession!(token, "session-secret", 60_000, issuedAt + 30_000),
    ).toEqual({ username: "platepost-admin", issuedAt });
  });

  it("rejects a tampered token", async () => {
    const auth = await loadAdminAuth();
    expect(auth.createAdminSession).toBeTypeOf("function");
    expect(auth.verifyAdminSession).toBeTypeOf("function");

    const token = auth.createAdminSession!("admin", "session-secret", 1_000);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(auth.verifyAdminSession!(tampered, "session-secret", 60_000, 2_000)).toBeNull();
  });

  it("rejects expired sessions and future timestamps", async () => {
    const auth = await loadAdminAuth();
    expect(auth.createAdminSession).toBeTypeOf("function");
    expect(auth.verifyAdminSession).toBeTypeOf("function");

    const token = auth.createAdminSession!("admin", "session-secret", 10_000);
    expect(auth.verifyAdminSession!(token, "session-secret", 1_000, 11_001)).toBeNull();

    const futureToken = auth.createAdminSession!("admin", "session-secret", 20_000);
    expect(auth.verifyAdminSession!(futureToken, "session-secret", 1_000, 10_000)).toBeNull();
  });

  it("fails closed when the signing secret or token is missing", async () => {
    const auth = await loadAdminAuth();
    expect(auth.createAdminSession).toBeTypeOf("function");
    expect(auth.verifyAdminSession).toBeTypeOf("function");

    expect(() => auth.createAdminSession!("admin", "")).toThrow("session secret");
    expect(auth.verifyAdminSession!("anything", undefined)).toBeNull();
    expect(auth.verifyAdminSession!(undefined, "session-secret")).toBeNull();
  });
});
