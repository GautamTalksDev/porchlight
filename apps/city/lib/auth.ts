import "server-only";
import { auth0, auth0Configured } from "./auth0";

export type AuthMode = "auth0" | "local-open" | "not-configured";

/** Production without Auth0 fails closed. Local development without Auth0 is open, with a visible banner. */
export function authMode(): AuthMode {
  if (auth0Configured) return "auth0";
  return process.env.NODE_ENV === "production" ? "not-configured" : "local-open";
}

export interface Coordinator {
  name: string;
  email?: string;
  mode: AuthMode;
}

export async function currentCoordinator(): Promise<Coordinator | null> {
  const mode = authMode();
  if (mode === "local-open") return { name: "Local developer", mode };
  if (mode === "not-configured" || !auth0) return null;
  const session = await auth0.getSession();
  if (!session) return null;
  const allow = (process.env.COORDINATOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const email = (session.user.email as string | undefined)?.toLowerCase();
  if (allow.length && (!email || !allow.includes(email))) return null;
  return { name: (session.user.name as string) ?? email ?? "Coordinator", email, mode };
}

/** For route handlers: returns a Response to send back if the caller is not a coordinator. */
export async function denyUnlessCoordinator(): Promise<Response | null> {
  if (authMode() === "not-configured") {
    return Response.json({ ok: false, reason: "Sign-in is not configured on this server" }, { status: 503 });
  }
  const c = await currentCoordinator();
  if (!c) return Response.json({ ok: false, reason: "Sign in as a coordinator first" }, { status: 401 });
  return null;
}
