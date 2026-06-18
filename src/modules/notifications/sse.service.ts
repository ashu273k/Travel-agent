import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter } from "events";

// ── SSE Event Types ───────────────────────────────────────────────────────────

export type SseEventType =
  | "graph:node_start"
  | "graph:search_complete"
  | "graph:day_assembled"
  | "graph:conflict_detected"
  | "graph:conflict_resolved"
  | "graph:change_impact"
  | "graph:complete"
  | "graph:error";

export interface SseEvent {
  type: SseEventType;
  sessionId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * SseService — Real-Time Graph Event Bus
 *
 * Acts as a lightweight in-process event bus that bridges the LangGraph
 * state machine to the SSE HTTP endpoint.
 *
 * Usage pattern:
 *   1. Graph nodes call `sseService.emit(sessionId, type, payload)`
 *      at key milestones (search complete, day assembled, conflict resolved…)
 *   2. `SseController` subscribes via `subscribe(sessionId)` and pipes
 *      events as SSE frames to the connected HTTP client.
 *
 * Lifecycle:
 *   - Each sessionId gets its own EventEmitter channel.
 *   - The channel is cleaned up automatically when the graph emits `graph:complete`
 *     or `graph:error`, or when the SSE client disconnects (via `unsubscribe()`).
 *
 * Design note:
 *   An in-process EventEmitter is used rather than Redis pub/sub intentionally:
 *   this is a single-instance NestJS app (no horizontal scaling in Phase 4).
 *   For multi-instance deployments, replace with BullMQ events or Redis pub/sub.
 */
@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);

  /** Map of sessionId → EventEmitter channel */
  private readonly channels = new Map<string, EventEmitter>();

  // ── Emit API (called by graph nodes) ───────────────────────────────────────

  /**
   * Emit an SSE event for a given session.
   * Silently drops events for sessions with no active SSE subscriber.
   */
  emit(
    sessionId: string,
    type: SseEventType,
    payload: Record<string, unknown> = {},
  ): void {
    const channel = this.channels.get(sessionId);
    if (!channel) {
      // No active subscriber — drop silently (client may not be listening yet)
      return;
    }

    const event: SseEvent = {
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.logger.debug(`SSE emit [${sessionId}] → ${type}`);
    channel.emit("event", event);

    // Auto-cleanup after terminal events
    if (type === "graph:complete" || type === "graph:error") {
      // Small delay so the client can receive the final frame before the channel closes
      setTimeout(() => this.destroyChannel(sessionId), 500);
    }
  }

  // ── Subscribe API (called by SseController) ────────────────────────────────

  /**
   * Subscribe to events for a given session.
   * Creates the channel if it does not yet exist.
   *
   * @param sessionId   Session to subscribe to.
   * @param onEvent     Callback invoked for each SSE event.
   * @returns           Unsubscribe function — call on client disconnect.
   */
  subscribe(sessionId: string, onEvent: (event: SseEvent) => void): () => void {
    // Create channel if not yet created (graph may not have started emitting)
    if (!this.channels.has(sessionId)) {
      this.channels.set(sessionId, new EventEmitter());
    }

    const channel = this.channels.get(sessionId)!;
    channel.on("event", onEvent);

    this.logger.log(`SSE client subscribed to session [${sessionId}]`);

    // Return unsubscribe function
    return () => this.unsubscribe(sessionId, onEvent);
  }

  /**
   * Remove a specific listener from a session channel.
   * Called when the HTTP client disconnects.
   */
  unsubscribe(sessionId: string, onEvent: (event: SseEvent) => void): void {
    const channel = this.channels.get(sessionId);
    if (channel) {
      channel.off("event", onEvent);
      this.logger.log(`SSE client unsubscribed from session [${sessionId}]`);

      // Clean up the channel if there are no more listeners
      if (channel.listenerCount("event") === 0) {
        this.destroyChannel(sessionId);
      }
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Destroys the event channel for a session, releasing memory */
  private destroyChannel(sessionId: string): void {
    const channel = this.channels.get(sessionId);
    if (channel) {
      channel.removeAllListeners();
      this.channels.delete(sessionId);
      this.logger.debug(`SSE channel destroyed for session [${sessionId}]`);
    }
  }

  /** Returns the number of currently active SSE channels (for health checks) */
  activeChannelCount(): number {
    return this.channels.size;
  }
}
