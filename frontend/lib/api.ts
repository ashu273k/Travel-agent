import type { Itinerary } from "./types";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function submitBrief(
  userId: string,
  brief: string
): Promise<{ sessionId: string; tripId: string }> {
  const res = await fetch(`${BACKEND}/api/api/brief/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, brief }),
  });
  return handleResponse<{ sessionId: string; tripId: string }>(res);
}

export async function getItinerary(tripId: string): Promise<Itinerary> {
  const res = await fetch(`${BACKEND}/api/api/itinerary/${tripId}`, {
    cache: "no-store",
  });
  return handleResponse<Itinerary>(res);
}

export async function confirmBooking(tripId: string): Promise<void> {
  const res = await fetch(`${BACKEND}/api/api/bookings/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tripId }),
  });
  await handleResponse<unknown>(res);
}

export async function requestChange(
  sessionId: string,
  changeType: string,
  affectedBookingRef: string,
  newDetails?: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${BACKEND}/api/api/changes/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      changeRequest: {
        changeType,
        affectedBookingRef,
        newDetails: newDetails ?? {},
        timestamp: new Date().toISOString(),
      },
    }),
  });
  await handleResponse<unknown>(res);
}

/**
 * Opens an SSE stream for the given session.
 * Returns a cleanup function that closes the EventSource.
 */
const SSE_EVENT_TYPES = [
  "graph:node_start",
  "graph:search_complete",
  "graph:day_assembled",
  "graph:conflict_detected",
  "graph:conflict_resolved",
  "graph:change_impact",
  "graph:complete",
  "graph:error",
] as const;

export function streamSession(
  sessionId: string,
  onEvent: (type: string, payload: unknown) => void,
  onDone: () => void,
  onError: (e: string) => void
): () => void {
  const url = `${BACKEND}/api/api/sessions/${sessionId}/stream`;
  const es = new EventSource(url);

  // The backend sends named SSE events (event: graph:complete\n), so we must
  // use addEventListener per event type — es.onmessage only fires for unnamed events.
  for (const eventType of SSE_EVENT_TYPES) {
    es.addEventListener(eventType, (raw: MessageEvent) => {
      try {
        const parsed = JSON.parse(raw.data) as { type: string; payload: unknown };
        onEvent(eventType, parsed.payload ?? parsed);
        if (eventType === "graph:complete") {
          onDone();
          es.close();
        } else if (eventType === "graph:error") {
          const msg = (parsed.payload as { message?: string })?.message ?? "Stream error";
          onError(msg);
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    });
  }

  // Also catch unnamed messages as fallback
  es.onmessage = (raw) => {
    try {
      const parsed = JSON.parse(raw.data) as { type: string; payload: unknown };
      onEvent(parsed.type, parsed.payload);
      if (parsed.type === "graph:complete") { onDone(); es.close(); }
    } catch {}
  };

  es.onerror = () => {
    // If onerror fires immediately it likely means the session already completed
    // and the channel was destroyed. Treat it as done and fetch the itinerary.
    es.close();
    onDone();
  };

  return () => es.close();
}
