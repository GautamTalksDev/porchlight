import { NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

/** Next.js 16 request boundary. Auth0 handles /auth/* and keeps sessions rolling. */
export async function proxy(request: Request) {
  if (auth0) return await auth0.middleware(request);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|audio/|sim-report.json|robots.txt).*)"],
};
