import { Brand } from "./Brand";

export function SignInGate({ reason }: { reason: "signed-out" | "not-configured" }) {
  return (
    <main className="gate">
      <div className="gate-card">
        <Brand />
        {reason === "signed-out" ? (
          <>
            <h1>Sign in to the operations room</h1>
            <p>This room shows health needs for real households, so it is only open to city coordinators.</p>
            <div className="actions">
              <a className="btn btn-porch" href="/auth/login?returnTo=/ops">Sign in</a>
              <a className="btn btn-quiet" href="/present">Watch the story instead</a>
            </div>
          </>
        ) : (
          <>
            <h1>Sign-in is not set up on this server</h1>
            <p>
              Add AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET and AUTH0_SECRET to the environment. Until then the
              operations room stays closed, because it holds sensitive information.
            </p>
            <a className="btn btn-quiet" href="/present">Watch the story</a>
          </>
        )}
      </div>
    </main>
  );
}
