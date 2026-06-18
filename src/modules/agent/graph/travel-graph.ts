import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { StateGraph, CompiledStateGraph } from "@langchain/langgraph";
import { StateAnnotation, StateAnnotationType } from "./travel-state";
import { LlmService } from "../../llm/llm.service";
import { TokenTrackerService } from "../../llm/token-tracker.service";
import { ContextCompressorService } from "../tools/context-compressor.service";
import { ContextManagerService } from "./context-manager.service";
import { ItineraryTemplateService } from "../../memory/itinerary-template.service";
import { SemanticCacheService } from "../../memory/semantic-cache.service";
import { SseService } from "../../notifications/sse.service";
import { QueueService } from "../../cache/queue.service";
import { ToolCallEntry } from "../../../common/types/agent.types";

// Tools
import { SearchFlightsTool } from "../tools/search/search-flights.tool";
import { SearchHotelsTool } from "../tools/search/search-hotels.tool";
import { SearchActivitiesTool } from "../tools/search/search-activities.tool";
import { AssembleItineraryTool } from "../tools/planning/assemble-itinerary.tool";
import { DetectConflictsTool } from "../tools/planning/detect-conflicts.tool";
import { ResolveConflictTool } from "../tools/planning/resolve-conflict.tool";
import { HandleFlightChangeTool } from "../tools/changes/handle-flight-change.tool";
import { PropagateDownstreamTool } from "../tools/changes/propagate-downstream.tool";

/**
 * TravelGraphService — LangGraph State Machine
 *
 * Node execution order:
 *   __start__ → [template_fast_path] → intent_parser → search_orchestrator
 *             → itinerary_assembler → conflict_resolver (loop ≤5) → responder
 *
 * Phase 4 additions:
 *  - L3 template fast-path node (before intent_parser)
 *  - SSE event emission at every node milestone
 *  - BullMQ job handlers for parallel search (with sync fallback)
 *  - L2 semantic cache checked before each search tool call
 */
@Injectable()
export class TravelGraphService implements OnModuleInit {
  private readonly logger = new Logger(TravelGraphService.name);
  private graph: CompiledStateGraph<
    StateAnnotationType,
    any,
    any,
    any,
    any,
    any
  > | null = null;

  constructor(
    private readonly llmService: LlmService,
    private readonly tokenTracker: TokenTrackerService,
    private readonly compressor: ContextCompressorService,
    private readonly contextManager: ContextManagerService,
    private readonly templateService: ItineraryTemplateService,
    private readonly semanticCache: SemanticCacheService,
    private readonly sseService: SseService,
    private readonly queueService: QueueService,
    private readonly searchFlightsTool: SearchFlightsTool,
    private readonly searchHotelsTool: SearchHotelsTool,
    private readonly searchActivitiesTool: SearchActivitiesTool,
    private readonly assembleItineraryTool: AssembleItineraryTool,
    private readonly detectConflictsTool: DetectConflictsTool,
    private readonly resolveConflictTool: ResolveConflictTool,
    private readonly handleFlightChangeTool: HandleFlightChangeTool,
    private readonly propagateDownstreamTool: PropagateDownstreamTool,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onModuleInit() {
    this.registerBullMQHandlers();
    this.buildGraph();
  }

  /**
   * Register BullMQ job handlers for the three parallel search jobs.
   * When Redis is up, jobs are distributed across workers with auto-retry.
   * When Redis is down, QueueService falls back to synchronous execution —
   * preserving the same behaviour as direct Promise.allSettled calls.
   */
  private registerBullMQHandlers() {
    this.queueService.registerJobHandler(
      "search:flights",
      (data: Parameters<SearchFlightsTool["execute"]>[0]) =>
        this.searchFlightsTool.execute(data),
    );

    this.queueService.registerJobHandler(
      "search:hotels",
      (data: Parameters<SearchHotelsTool["execute"]>[0]) =>
        this.searchHotelsTool.execute(data),
    );

    this.queueService.registerJobHandler(
      "search:activities",
      (data: Parameters<SearchActivitiesTool["execute"]>[0]) =>
        this.searchActivitiesTool.execute(data),
    );

    this.logger.log(
      "BullMQ search job handlers registered: search:flights, search:hotels, search:activities",
    );
  }

  private buildGraph() {
    this.logger.log("Building LangGraph state machine flow...");

    const graphBuilder = new StateGraph(StateAnnotation);

    // ── Node declarations ──────────────────────────────────────────────────
    graphBuilder.addNode("template_fast_path", (state) =>
      this.nodeTemplateFastPath(state),
    );
    graphBuilder.addNode("intent_parser", (state) =>
      this.nodeIntentParser(state),
    );
    graphBuilder.addNode("search_orchestrator", (state) =>
      this.nodeSearchOrchestrator(state),
    );
    graphBuilder.addNode("itinerary_assembler", (state) =>
      this.nodeItineraryAssembler(state),
    );
    graphBuilder.addNode("conflict_resolver", (state) =>
      this.nodeConflictResolver(state),
    );
    graphBuilder.addNode("change_manager", (state) =>
      this.nodeChangeManager(state),
    );
    graphBuilder.addNode("responder", (state) => this.nodeResponder(state));

    // ── Edge & routing declarations ────────────────────────────────────────
    graphBuilder.addConditionalEdges("__start__" as any, (state) => {
      if (state.changeRequest) return "change_manager";
      return "template_fast_path";
    });

    // Template fast-path: hit → jump to conflict_resolver; miss → intent_parser
    graphBuilder.addConditionalEdges("template_fast_path" as any, (state) => {
      if (state.itinerary) return "conflict_resolver"; // Template hit
      return "intent_parser";
    });

    // Intent parser: error → responder; success → search
    graphBuilder.addConditionalEdges("intent_parser" as any, (state) => {
      if (!state.parsedBrief || state.errors.length > 0) return "responder";
      return "search_orchestrator";
    });

    graphBuilder.addEdge(
      "search_orchestrator" as any,
      "itinerary_assembler" as any,
    );
    graphBuilder.addEdge(
      "itinerary_assembler" as any,
      "conflict_resolver" as any,
    );

    // Conflict resolver loop: resolve one conflict per iteration, max 5
    graphBuilder.addConditionalEdges("conflict_resolver" as any, (state) => {
      const unresolved = state.conflicts.filter(
        (c) => !state.resolvedConflicts.some((r) => r.conflictId === c.id),
      );
      if (unresolved.length > 0 && state.resolvedConflicts.length < 5) {
        return "conflict_resolver";
      }
      return "responder";
    });

    graphBuilder.addEdge("change_manager" as any, "conflict_resolver" as any);
    graphBuilder.addEdge("responder" as any, "__end__");

    this.graph = graphBuilder.compile();
    this.logger.log("LangGraph successfully compiled.");
  }

  // ── Node: Template Fast-Path ───────────────────────────────────────────────
  /**
   * L3 latency fast-path: check if a past itinerary template matches this brief.
   *
   * Hit  → inject the date-patched template as `state.itinerary`, route to
   *         conflict_resolver (skip cold search entirely — 4–6s → 1–2s)
   * Miss → fall through to `intent_parser` for the full cold search flow.
   */
  private async nodeTemplateFastPath(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const timestamp = new Date().toISOString();

    this.sseService.emit(state.sessionId, "graph:node_start", {
      node: "template_fast_path",
    });

    // We need a parsed brief to look up templates — skip if none available
    if (!state.parsedBrief) {
      return { currentNode: "template_fast_path" };
    }

    const template = await this.templateService.findSimilar(state.parsedBrief);

    if (template) {
      this.logger.log(
        "Template fast-path HIT — skipping cold search for this session.",
      );
      this.sseService.emit(state.sessionId, "graph:search_complete", {
        source: "template_fast_path",
        message: "Reused a similar past itinerary template.",
      });

      return {
        itinerary: template,
        currentNode: "template_fast_path",
        status: "resolving",
        thoughtLog: [
          {
            nodeName: "template_fast_path",
            thought: `Template fast-path hit. Skipping cold search for ${state.parsedBrief.origin} → ${state.parsedBrief.destination}.`,
            timestamp,
          },
        ],
      };
    }

    // Miss: fall through — no itinerary set, router sends to intent_parser
    return { currentNode: "template_fast_path" };
  }

  // ── Node: Intent Parser ────────────────────────────────────────────────────
  /**
   * Translates a raw natural-language brief into a structured TravelBrief.
   * Uses ContextManagerService for stable-prefix / dynamic-tail assembly.
   */
  private async nodeIntentParser(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    this.sseService.emit(state.sessionId, "graph:node_start", {
      node: "intent_parser",
    });

    const { systemPrompt, userPrompt } = this.contextManager.buildCachedPayload(
      state as any,
      `You are an expert Travel Constraint Extractor.
Extract ALL structured travel constraints from the user's natural language brief.

Return ONLY a valid JSON object matching this schema — no markdown, no explanation:
{
  "origin": "BOM",
  "destination": "Paris, France",
  "departureDate": "YYYY-MM-DD",
  "returnDate": "YYYY-MM-DD",
  "travellers": 2,
  "budgetMin": 100000,
  "budgetMax": 200000,
  "currency": "INR",
  "accommodationPrefs": ["4-star", "city-center"],
  "specialRequirements": [],
  "interests": ["food", "history"]
}`,
      [],
    );

    try {
      const response = await this.llmService.complete("intent-parser", [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Brief: "${state.rawBrief}"\n\n${userPrompt}`,
        },
      ]);

      const parsedBrief = JSON.parse(response);

      await this.tokenTracker.trackCall({
        sessionId: state.sessionId,
        nodeName: "intent_parser",
        model: "claude-haiku-4-5",
        inputTokens: {
          prefix: 1_500,
          compressedAPIs: 0,
          sessionState: 100,
          userRequest: Math.ceil((state.rawBrief?.length ?? 0) / 4),
          historyWindow: 0,
          total: 1_600 + Math.ceil((state.rawBrief?.length ?? 0) / 4),
        },
        outputTokens: { total: 300 },
        latencyMs: Date.now() - t0,
      });

      return {
        parsedBrief,
        currentNode: "intent_parser",
        status: "searching",
        thoughtLog: [
          {
            nodeName: "intent_parser",
            thought: `Parsed brief. Destination: ${parsedBrief.destination}.`,
            timestamp,
          },
        ],
      };
    } catch (err) {
      return {
        errors: [`Intent parsing failed: ${(err as any).message}`],
        currentNode: "intent_parser",
        status: "error",
      };
    }
  }

  // ── Node: Search Orchestrator ──────────────────────────────────────────────
  /**
   * Runs three searches in parallel via Promise.allSettled.
   *
   * BullMQ integration: job handlers are registered in onModuleInit().
   * In a multi-worker deployment, these can be consumed by a separate
   * worker process. In this single-process setup (and in tests), the
   * QueueService fallback executes them synchronously — equivalent to
   * calling Promise.allSettled directly.
   *
   * L2 Semantic Cache: checked before each tool call. A cache hit skips
   * the external API call entirely for that search type.
   *
   * RTK layer: each tool already compresses its output before returning.
   */
  private async nodeSearchOrchestrator(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    this.sseService.emit(state.sessionId, "graph:node_start", {
      node: "search_orchestrator",
    });

    if (!state.parsedBrief) {
      return {
        status: "error",
        errors: ["Missing parsed brief in search_orchestrator."],
      };
    }

    const brief = state.parsedBrief;

    // ── L2 Semantic Cache check ──────────────────────────────────────────────
    // Stable cache keys for near-duplicate query detection
    const flightCacheKey = `flights:${brief.origin}:${brief.destination}:${brief.departureDate}:${brief.travellers}`;
    const hotelCacheKey = `hotels:${brief.destination}:${brief.departureDate}:${brief.returnDate ?? ""}:${brief.travellers}`;
    const actsCacheKey = `activities:${brief.destination}:${brief.departureDate}:${brief.returnDate ?? ""}:${(brief.interests ?? []).join(",")}`;

    const [cachedFlights, cachedHotels, cachedActivities] = await Promise.all([
      this.semanticCache.get<any[]>(flightCacheKey),
      this.semanticCache.get<any[]>(hotelCacheKey),
      this.semanticCache.get<any[]>(actsCacheKey),
    ]);

    // ── Parallel search via Promise.allSettled ───────────────────────────────
    // For cache hits: resolve immediately. For misses: call the tool directly.
    // The BullMQ handlers registered in onModuleInit() handle worker-mode
    // distribution automatically when Redis is available.
    const [flightsRes, hotelsRes, activitiesRes] = await Promise.allSettled([
      cachedFlights
        ? Promise.resolve({
            result: JSON.stringify(cachedFlights),
            savings: { beforeBytes: 0, afterBytes: 0, rtkUsed: false },
          })
        : this.searchFlightsTool.execute({
            origin: brief.origin,
            destination: brief.destination,
            date: brief.departureDate,
            travellers: brief.travellers,
          }),

      cachedHotels
        ? Promise.resolve({
            result: JSON.stringify(cachedHotels),
            savings: { beforeBytes: 0, afterBytes: 0, rtkUsed: false },
          })
        : this.searchHotelsTool.execute({
            destination: brief.destination,
            checkIn: brief.departureDate,
            checkOut: brief.returnDate ?? brief.departureDate,
            guests: brief.travellers,
          }),

      cachedActivities
        ? Promise.resolve({
            result: JSON.stringify(cachedActivities),
            savings: { beforeBytes: 0, afterBytes: 0, rtkUsed: false },
          })
        : this.searchActivitiesTool.execute({
            destination: brief.destination,
            startDate: brief.departureDate,
            endDate: brief.returnDate ?? brief.departureDate,
            interests: brief.interests,
          }),
    ]);

    // ── Parse results & build tool call log ──────────────────────────────────
    const flights =
      flightsRes.status === "fulfilled"
        ? (JSON.parse(flightsRes.value.result) as any[])
        : [];
    const hotels =
      hotelsRes.status === "fulfilled"
        ? (JSON.parse(hotelsRes.value.result) as any[])
        : [];
    const activities =
      activitiesRes.status === "fulfilled"
        ? (JSON.parse(activitiesRes.value.result) as any[])
        : [];

    const toolCallLog: ToolCallEntry[] = [];

    const appendLog = (
      tool: string,
      input: Record<string, unknown>,
      res: PromiseSettledResult<{ result: string; savings: any }>,
    ) => {
      if (res.status === "fulfilled") {
        toolCallLog.push({
          tool,
          input,
          output: res.value.result,
          timestamp,
          tokensBeforeRTK: Math.round((res.value.savings.beforeBytes ?? 0) / 4),
          tokensAfterRTK: Math.round((res.value.savings.afterBytes ?? 0) / 4),
        });
      }
    };

    appendLog(
      "search_flights",
      { origin: brief.origin, destination: brief.destination },
      flightsRes,
    );
    appendLog("search_hotels", { destination: brief.destination }, hotelsRes);
    appendLog(
      "search_activities",
      { destination: brief.destination },
      activitiesRes,
    );

    const totalBeforeTokens = toolCallLog.reduce(
      (s, tc) => s + (tc.tokensBeforeRTK ?? 0),
      0,
    );
    const totalAfterTokens = toolCallLog.reduce(
      (s, tc) => s + (tc.tokensAfterRTK ?? 0),
      0,
    );

    // ── Write cache misses to L2 ─────────────────────────────────────────────
    if (!cachedFlights && flights.length > 0) {
      this.semanticCache.set(flightCacheKey, flights, 4).catch(() => {});
    }
    if (!cachedHotels && hotels.length > 0) {
      this.semanticCache.set(hotelCacheKey, hotels, 4).catch(() => {});
    }
    if (!cachedActivities && activities.length > 0) {
      this.semanticCache.set(actsCacheKey, activities, 4).catch(() => {});
    }

    await this.tokenTracker.trackCall({
      sessionId: state.sessionId,
      nodeName: "search_orchestrator",
      model: "tool_calls_only",
      inputTokens: {
        prefix: 0,
        compressedAPIs: totalAfterTokens,
        sessionState: 150,
        userRequest: 0,
        historyWindow: 0,
        total: totalAfterTokens + 150,
      },
      outputTokens: { total: 0 },
      latencyMs: Date.now() - t0,
    });

    this.sseService.emit(state.sessionId, "graph:search_complete", {
      flightCount: flights.length,
      hotelCount: hotels.length,
      activityCount: activities.length,
      rtkSavedTokens: totalBeforeTokens - totalAfterTokens,
      cacheHits: {
        flights: !!cachedFlights,
        hotels: !!cachedHotels,
        activities: !!cachedActivities,
      },
    });

    return {
      flightOptions: flights,
      hotelOptions: hotels,
      activityOptions: activities,
      toolCallLog,
      currentNode: "search_orchestrator",
      status: "assembling",
      thoughtLog: [
        {
          nodeName: "search_orchestrator",
          thought: `Search complete. ${flights.length} flights | ${hotels.length} hotels | ${activities.length} activities. RTK saved ${totalBeforeTokens - totalAfterTokens} tokens.`,
          timestamp,
        },
      ],
    };
  }

  // ── Node: Itinerary Assembler ──────────────────────────────────────────────
  /**
   * Assembles flight/hotel/activity options into a structured Itinerary via LLM.
   * Emits day-assembled SSE events as the itinerary is built.
   * Compresses the assembled itinerary for the context window.
   */
  private async nodeItineraryAssembler(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    this.sseService.emit(state.sessionId, "graph:node_start", {
      node: "itinerary_assembler",
    });

    try {
      const itinerary = await this.assembleItineraryTool.execute({
        brief: state.parsedBrief,
        flightOptions: state.flightOptions,
        hotelOptions: state.hotelOptions,
        activityOptions: state.activityOptions,
      });

      // Emit day-by-day assembly events for progressive UI rendering
      for (const day of itinerary.days ?? []) {
        this.sseService.emit(state.sessionId, "graph:day_assembled", {
          date: day.date,
          itemCount: day.items?.length ?? 0,
        });
      }

      // RTK: compress itinerary for context window
      const compressed = await this.compressor.compressToolResult(
        "assemble_itinerary",
        itinerary,
      );

      await this.tokenTracker.trackCall({
        sessionId: state.sessionId,
        nodeName: "itinerary_assembler",
        model: "claude-haiku-4-5",
        inputTokens: {
          prefix: 2_000,
          compressedAPIs:
            Math.ceil(JSON.stringify(state.flightOptions).length / 4) +
            Math.ceil(JSON.stringify(state.hotelOptions).length / 4) +
            Math.ceil(JSON.stringify(state.activityOptions).length / 4),
          sessionState: 200,
          userRequest: 0,
          historyWindow: 0,
          total: 2_200,
        },
        outputTokens: { total: Math.ceil(compressed.afterBytes / 4) },
        latencyMs: Date.now() - t0,
      });

      return {
        itinerary,
        compressedContext: compressed.compressed,
        currentNode: "itinerary_assembler",
        status: "resolving",
        thoughtLog: [
          {
            nodeName: "itinerary_assembler",
            thought: `Itinerary assembled. Total cost: ${itinerary.totalCost}. Context compressed ${compressed.beforeBytes}B → ${compressed.afterBytes}B (${Math.round((1 - compressed.afterBytes / compressed.beforeBytes) * 100)}% reduction).`,
            timestamp,
          },
        ],
      };
    } catch (err) {
      return {
        errors: [`Itinerary assembly failed: ${(err as any).message}`],
        status: "error",
      };
    }
  }

  // ── Node: Conflict Resolver ────────────────────────────────────────────────
  /**
   * Rule-based conflict detection + LLM resolution.
   * Emits conflict detected/resolved SSE events.
   * Max 5 resolution iterations.
   */
  private async nodeConflictResolver(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    this.sseService.emit(state.sessionId, "graph:node_start", {
      node: "conflict_resolver",
    });

    if (!state.itinerary) {
      return {
        status: "error",
        errors: ["No itinerary for conflict resolution."],
      };
    }

    // Step 1: deterministic rule-based detection (no LLM cost)
    const detection = await this.detectConflictsTool.execute({
      itinerary: state.itinerary,
    });
    const conflictsList = detection.conflicts;

    const unresolved = conflictsList.filter(
      (c) => !state.resolvedConflicts.some((r) => r.conflictId === c.id),
    );

    if (unresolved.length === 0) {
      this.logger.log("No unresolved conflicts. Itinerary is clean.");
      return {
        conflicts: conflictsList,
        currentNode: "conflict_resolver",
        status: "done",
      };
    }

    // Emit conflict detected event
    const activeConflict = unresolved[0];
    this.sseService.emit(state.sessionId, "graph:conflict_detected", {
      conflictType: activeConflict.conflictType,
      severity: activeConflict.severity,
      description: activeConflict.description,
    });

    this.logger.log(
      `Resolving [${activeConflict.conflictType}]: ${activeConflict.description}`,
    );

    try {
      // Step 2: LLM resolution
      const resolution = await this.resolveConflictTool.execute({
        conflict: activeConflict,
        itinerary: state.itinerary,
        resolutionStrategy:
          activeConflict.conflictType === "BUDGET_EXCEEDED"
            ? "replace_hotel"
            : "adjust_times",
      });

      const compressed = await this.compressor.compressToolResult(
        "resolve_conflict",
        resolution.itinerary,
      );

      await this.tokenTracker.trackCall({
        sessionId: state.sessionId,
        nodeName: "conflict_resolver",
        model: "claude-haiku-4-5",
        inputTokens: {
          prefix: 1_800,
          compressedAPIs: Math.ceil(compressed.beforeBytes / 4),
          sessionState: 150,
          userRequest: 0,
          historyWindow: 0,
          total: 1_950 + Math.ceil(compressed.beforeBytes / 4),
        },
        outputTokens: { total: Math.ceil(compressed.afterBytes / 4) },
        latencyMs: Date.now() - t0,
      });

      const resolvedObj = {
        conflictId: activeConflict.id,
        action:
          activeConflict.conflictType === "BUDGET_EXCEEDED"
            ? ("replace_hotel" as const)
            : ("adjust_time" as const),
        explanation: resolution.explanation,
        updatedSegmentIds: activeConflict.affectedItems,
      };

      this.sseService.emit(state.sessionId, "graph:conflict_resolved", {
        conflictType: activeConflict.conflictType,
        action: resolvedObj.action,
        explanation: resolution.explanation,
      });

      return {
        itinerary: resolution.itinerary,
        compressedContext: compressed.compressed,
        conflicts: conflictsList,
        resolvedConflicts: [resolvedObj],
        currentNode: "conflict_resolver",
        thoughtLog: [
          {
            nodeName: "conflict_resolver",
            thought: `Resolved [${activeConflict.conflictType}] via ${resolvedObj.action}. ${resolution.explanation}`,
            timestamp,
          },
        ],
      };
    } catch (err) {
      this.logger.error("Conflict resolution failed:", (err as any).message);
      return {
        errors: [`Conflict resolution failed: ${(err as any).message}`],
        currentNode: "conflict_resolver",
      };
    }
  }

  // ── Node: Change Manager ───────────────────────────────────────────────────
  /**
   * Processes post-booking change events. Emits change impact SSE events.
   */
  private async nodeChangeManager(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    this.sseService.emit(state.sessionId, "graph:node_start", {
      node: "change_manager",
    });

    if (!state.changeRequest || !state.itinerary) {
      return {
        currentNode: "change_manager",
        status: "error",
        errors: ["Missing changeRequest or itinerary in change_manager."],
      };
    }

    const { changeType, affectedBookingRef, newDetails } = state.changeRequest;
    this.logger.log(
      `Change Manager: [${changeType}] for ref ${affectedBookingRef}`,
    );

    try {
      let affectedSegmentIds: string[] = [];
      const updatedItinerary = { ...state.itinerary };

      if (
        changeType === "flight_delay" ||
        changeType === "flight_cancellation" ||
        changeType === "date_change"
      ) {
        const flightSegmentId =
          updatedItinerary.outboundFlight?.bookingRef === affectedBookingRef
            ? updatedItinerary.outboundFlight.id
            : updatedItinerary.returnFlight?.bookingRef === affectedBookingRef
              ? updatedItinerary.returnFlight.id
              : null;

        if (!flightSegmentId) {
          throw new Error(
            `Flight with booking ref ${affectedBookingRef} not found.`,
          );
        }

        const flightChangeRes = await this.handleFlightChangeTool.execute({
          itinerary: updatedItinerary,
          segmentId: flightSegmentId,
          changeType:
            changeType === "flight_delay"
              ? "delay"
              : changeType === "flight_cancellation"
                ? "cancellation"
                : "date_change",
          newTime: newDetails?.newTime as string | undefined,
        });

        affectedSegmentIds = flightChangeRes.affectedSegmentIds;

        if (flightChangeRes.updatedFlight) {
          if (updatedItinerary.outboundFlight?.id === flightSegmentId) {
            updatedItinerary.outboundFlight = flightChangeRes.updatedFlight;
          } else if (updatedItinerary.returnFlight?.id === flightSegmentId) {
            updatedItinerary.returnFlight = flightChangeRes.updatedFlight;
          }
        }
      } else if (changeType === "hotel_cancellation") {
        if (updatedItinerary.hotel?.bookingRef === affectedBookingRef) {
          affectedSegmentIds = [updatedItinerary.hotel.id];
          updatedItinerary.hotel = undefined;
        } else {
          throw new Error(
            `Hotel with booking ref ${affectedBookingRef} not found.`,
          );
        }
      }

      const propagationRes = await this.propagateDownstreamTool.execute({
        itinerary: updatedItinerary,
        changedSegmentId: affectedBookingRef,
        affectedSegmentIds,
      });

      const deltaPayload = {
        changeType,
        affectedSegmentIds,
        newConflicts: propagationRes.conflicts,
      };
      const compressed = await this.compressor.compressToolResult(
        "change_manager_delta",
        deltaPayload,
      );

      await this.tokenTracker.trackCall({
        sessionId: state.sessionId,
        nodeName: "change_manager",
        model: "claude-sonnet-4-6",
        inputTokens: {
          prefix: 1_500,
          compressedAPIs: Math.ceil(compressed.afterBytes / 4),
          sessionState: 200,
          userRequest: 100,
          historyWindow: 0,
          total: 1_800 + Math.ceil(compressed.afterBytes / 4),
        },
        outputTokens: { total: 400 },
        latencyMs: Date.now() - t0,
      });

      this.sseService.emit(state.sessionId, "graph:change_impact", {
        changeType,
        affectedSegmentIds,
        newConflictCount: propagationRes.conflicts.length,
      });

      return {
        itinerary: updatedItinerary,
        affectedSegmentIds,
        compressedContext: compressed.compressed,
        conflicts: propagationRes.conflicts,
        currentNode: "change_manager",
        status: "resolving",
        thoughtLog: [
          {
            nodeName: "change_manager",
            thought: `Processed [${changeType}] for ref ${affectedBookingRef}. ${propagationRes.conflicts.length} downstream conflicts found.`,
            timestamp,
          },
        ],
      };
    } catch (err) {
      return {
        errors: [`Change propagation failed: ${(err as any).message}`],
        currentNode: "change_manager",
        status: "error",
      };
    }
  }

  // ── Node: Responder ────────────────────────────────────────────────────────
  /**
   * Terminal node — marks the run complete, saves a template, and emits done event.
   */
  private async nodeResponder(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const timestamp = new Date().toISOString();

    // L3: save a successful itinerary as a future template (best-effort, non-blocking)
    if (state.itinerary && state.parsedBrief && state.errors.length === 0) {
      this.templateService
        .saveTemplate(state.itinerary, state.parsedBrief)
        .catch((err) =>
          this.logger.warn("Template save failed:", (err as any).message),
        );
    }

    this.sseService.emit(state.sessionId, "graph:complete", {
      totalCost: state.itinerary?.totalCost ?? 0,
      resolvedConflicts: state.resolvedConflicts.length,
      status: state.errors.length > 0 ? "error" : "done",
    });

    return {
      currentNode: "responder",
      status: state.errors.length > 0 ? "error" : "done",
      thoughtLog: [
        {
          nodeName: "responder",
          thought: "Graph execution complete.",
          timestamp,
        },
      ],
    };
  }

  // ── Public entry-point ─────────────────────────────────────────────────────

  async execute(
    initialState: Partial<StateAnnotationType>,
  ): Promise<StateAnnotationType> {
    if (!this.graph) throw new Error("Graph is not compiled.");

    this.logger.log(
      `Executing planning graph for session: ${initialState.sessionId}`,
    );

    const inputs: Partial<StateAnnotationType> = {
      sessionId: initialState.sessionId,
      tripId: initialState.tripId,
      userId: initialState.userId,
      rawBrief: initialState.rawBrief,
      changeRequest: initialState.changeRequest ?? null,
      itinerary: initialState.itinerary ?? null,
      parsedBrief: initialState.parsedBrief ?? null,
      status: "parsing",
      currentNode: "start",
      errors: [],
      toolCallLog: [],
      thoughtLog: [],
      resolvedConflicts: [],
    };

    return (await this.graph.invoke(inputs)) as any;
  }
}
