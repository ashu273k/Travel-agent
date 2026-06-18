import {
  Controller,
  Get,
  Param,
  Sse,
  MessageEvent,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { SseService, SseEvent } from "./sse.service";

/**
 * SseController — Real-Time Itinerary Assembly Stream
 *
 * Provides a single SSE endpoint that a frontend client connects to in order
 * to receive live updates as the LangGraph agent assembles an itinerary.
 *
 * Endpoint:
 *   GET /api/sessions/:sessionId/stream
 *
 * SSE Frame Format:
 *   data: {"type":"graph:search_complete","sessionId":"...","timestamp":"...","payload":{...}}\n\n
 *
 * Event types emitted (in order):
 *   1. graph:node_start         — a graph node has begun executing
 *   2. graph:search_complete    — parallel search finished; includes RTK savings
 *   3. graph:day_assembled      — itinerary assembler produced one day plan
 *   4. graph:conflict_detected  — a scheduling/budget conflict was found
 *   5. graph:conflict_resolved  — a conflict was resolved; includes explanation
 *   6. graph:change_impact      — change manager identified affected segments
 *   7. graph:complete           — graph run finished; includes final summary
 *   8. graph:error              — graph run failed; includes error message
 *
 * Client lifecycle:
 *   - Client opens SSE connection → `subscribe()` is called
 *   - Events stream as the graph progresses
 *   - After `graph:complete` or `graph:error`, connection is closed server-side
 *   - If the client disconnects early, the subscription is cleaned up via `OnModuleDestroy`
 *     but more immediately via the Observable teardown logic
 */
@Controller("api/sessions")
export class SseController implements OnModuleDestroy {
  private readonly logger = new Logger(SseController.name);

  /** Track all open subscription cleanup functions for graceful shutdown */
  private readonly activeSubscriptions = new Set<() => void>();

  constructor(private readonly sseService: SseService) {}

  @Sse(":sessionId/stream")
  stream(@Param("sessionId") sessionId: string): Observable<MessageEvent> {
    this.logger.log(`SSE connection opened for session [${sessionId}]`);

    const subject = new Subject<MessageEvent>();

    // Subscribe to the SseService event bus for this session
    const unsubscribe = this.sseService.subscribe(
      sessionId,
      (event: SseEvent) => {
        if (subject.closed) return;

        subject.next({
          data: JSON.stringify(event),
          id: `${event.sessionId}-${Date.now()}`,
          type: event.type,
        });

        // Close the stream after terminal events
        if (event.type === "graph:complete" || event.type === "graph:error") {
          subject.complete();
        }
      },
    );

    this.activeSubscriptions.add(unsubscribe);

    // Observable teardown: clean up when client disconnects
    return new Observable<MessageEvent>((subscriber) => {
      const sub = subject.subscribe(subscriber);

      return () => {
        this.logger.log(`SSE client disconnected from session [${sessionId}]`);
        unsubscribe();
        this.activeSubscriptions.delete(unsubscribe);
        sub.unsubscribe();
      };
    });
  }

  onModuleDestroy() {
    // Clean up all subscriptions on server shutdown
    for (const unsub of this.activeSubscriptions) {
      unsub();
    }
    this.activeSubscriptions.clear();
    this.logger.log("All SSE subscriptions cleaned up on shutdown.");
  }
}
