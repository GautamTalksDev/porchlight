import { denyUnlessCoordinator } from "@/lib/auth";
import { snapshot, subscribe, type CityMessage } from "@/lib/city";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-sent events: a fresh snapshot after every change, plus the raw deliveries for animation. */
export async function GET(req: Request) {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };
      send("snapshot", await snapshot());
      let pending: ReturnType<typeof setTimeout> | undefined;
      unsubscribe = subscribe((m: CityMessage) => {
        send("message", m);
        if (pending) return;
        pending = setTimeout(async () => {
          pending = undefined;
          send("snapshot", await snapshot());
        }, 150);
      });
      keepAlive = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15_000);
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        if (keepAlive) clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
    cancel() {
      unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
