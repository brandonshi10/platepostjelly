import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSession,
} from "@/src/lib/jellyhunt/admin-auth";
import {
  adminCredentialsAreValid,
  adminEnvironmentConfigured,
  requestHasTrustedOrigin,
} from "@/src/lib/jellyhunt/admin-server";

type LoginInput = { username?: unknown; password?: unknown };

async function readLoginInput(request: NextRequest): Promise<{ input: LoginInput; form: boolean }> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    return { input: (await request.json()) as LoginInput, form: false };
  }
  const data = await request.formData();
  return {
    input: { username: data.get("username"), password: data.get("password") },
    form: true,
  };
}

function loginFailure(request: NextRequest, form: boolean, reason: "invalid" | "configuration") {
  if (form) {
    return NextResponse.redirect(new URL(`/admin?error=${reason}`, request.url), 303);
  }
  return NextResponse.json(
    {
      error: {
        code: reason === "invalid" ? "invalid_admin_credentials" : "admin_not_configured",
        message:
          reason === "invalid"
            ? "The username or password did not match."
            : "Admin access is not configured.",
      },
    },
    { status: reason === "invalid" ? 401 : 503 },
  );
}

export async function POST(request: NextRequest) {
  if (!requestHasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: { code: "untrusted_origin", message: "This request origin is not allowed." } },
      { status: 403 },
    );
  }

  let parsed: Awaited<ReturnType<typeof readLoginInput>>;
  try {
    parsed = await readLoginInput(request);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_login_request", message: "Username and password are required." } },
      { status: 400 },
    );
  }

  if (!adminEnvironmentConfigured()) return loginFailure(request, parsed.form, "configuration");
  const username = typeof parsed.input.username === "string" ? parsed.input.username : "";
  const password = typeof parsed.input.password === "string" ? parsed.input.password : "";
  if (!adminCredentialsAreValid(username, password)) {
    return loginFailure(request, parsed.form, "invalid");
  }

  const token = createAdminSession(username, process.env.JELLYHUNT_ADMIN_SESSION_SECRET!);
  const response = parsed.form
    ? NextResponse.redirect(new URL("/admin", request.url), 303)
    : NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!requestHasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: { code: "untrusted_origin", message: "This request origin is not allowed." } },
      { status: 403 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
