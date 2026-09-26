import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0Configured = Boolean(
  process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET && process.env.AUTH0_SECRET,
);

/** Auth0 v4 client. Null when not configured, so local development still runs. */
export const auth0: Auth0Client | null = auth0Configured
  ? new Auth0Client({
      appBaseUrl: process.env.APP_BASE_URL || undefined,
      authorizationParameters: { scope: "openid profile email" },
      session: { rolling: true, absoluteDuration: 60 * 60 * 12, inactivityDuration: 60 * 60 * 2 },
    })
  : null;
