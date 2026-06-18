import { Injectable, Logger } from "@nestjs/common";
import { StateGraph, CompiledStateGraph } from "@langchain/langgraph";
import { StateAnnotation, StateAnnotationType } from "./travel-state";
import { LlmService } from "../../llm/llm.service";
import { TokenTrackerService } from "../../llm/token-tracker.service";
import { ContextCompressorService } from "../tools/context-compressor.service";
import { ContextManagerService } from "./context-manager.service";
import { ToolCallEntry } from "../../../common/types/agent.types";

// Tools injection
import { SearchFlightsTool } from "../tools/search/search-flights.tool";
import { SearchHotelsTool } from "../tools/search/search-hotels.tool";
import { SearchActivitiesTool } from "../tools/search/search-activities.tool";
import { AssembleItineraryTool } from "../tools/planning/assemble-itinerary.tool";
import { DetectConflictsTool } from "../tools/planning/detect-conflicts.tool";
import { ResolveConflictTool } from "../tools/planning/resolve-conflict.tool";
import { HandleFlightChangeTool } from "../tools/changes/handle-flight-change.tool";
import { PropagateDownstreamTool } from "../tools/changes/propagate-downstream.tool";

@Injectable()
export class TravelGraphService {
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
    private readonly searchFlightsTool: SearchFlightsTool,
    private readonly searchHotelsTool: SearchHotelsTool,
    private readonly searchActivitiesTool: SearchActivitiesTool,
    private readonly assembleItineraryTool: AssembleItineraryTool,
    private readonly detectConflictsTool: DetectConflictsTool,
    private readonly resolveConflictTool: ResolveConflictTool,
    private readonly handleFlightChangeTool: HandleFlightChangeTool,
    private readonly propagateDownstreamTool: PropagateDownstreamTool,
  ) {
    this.buildGraph();
  }

  private buildGraph() {
    this.logger.log("Building LangGraph state machine flow...");

    const graphBuilder = new StateGraph(StateAnnotation);

    // ── Node declarations ──────────────────────────────────────────────────
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
      if (state.changeRequest) {
        return "change_manager";
      }
      return "intent_parser";
    });

    graphBuilder.addConditionalEdges("intent_parser" as any, (state) => {
      if (!state.parsedBrief || state.errors.length > 0) {
        return "responder";
      }
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

    // Loop back for multi-conflict resolution (max 5 iterations)
    graphBuilder.addConditionalEdges("conflict_resolver" as any, (state) => {
      const unresolvedConflicts = state.conflicts.filter(
        (c) => !state.resolvedConflicts.some((r) => r.conflictId === c.id),
      );

      if (
        unresolvedConflicts.length > 0 &&
        state.resolvedConflicts.length < 5
      ) {
        return "conflict_resolver";
      }
      return "responder";
    });

    graphBuilder.addEdge("change_manager" as any, "conflict_resolver" as any);
    graphBuilder.addEdge("responder" as any, "__end__");

    this.graph = graphBuilder.compile();
    this.logger.log("LangGraph successfully compiled.");
  }

  // ── Node: Intent Parser ────────────────────────────────────────────────────
  /**
   * Translates a raw natural-language brief into a structured TravelBrief.
   *
   * RTK layer: the LLM response is a compact JSON object so no additional
   * compression step is needed here. Token tracking records the baseline.
   */
  private async nodeIntentParser(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    // Build prompt using ContextManagerService to ensure stable-prefix /
    // dynamic-tail separation is respected from the very first node.
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
      [], // No tools for intent parsing — structured output only
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
            thought: `Parsed travel brief. Destination: ${parsedBrief.destination}.`,
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
   * Executes flights, hotels, and activities searches in parallel.
   *
   * RTK layer: each search tool already pipes its raw API response through
   * ContextCompressorService before returning. Results stored in state are
   * already compressed strings — they are parsed once here for downstream use.
   */
  private async nodeSearchOrchestrator(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    if (!state.parsedBrief) {
      return {
        status: "error",
        errors: ["Missing parsed brief in search_orchestrator node."],
      };
    }

    const brief = state.parsedBrief;

    try {
      // Run all three searches in parallel — 3x latency reduction vs serial
      const [flightsRes, hotelsRes, activitiesRes] = await Promise.allSettled([
        this.searchFlightsTool.execute({
          origin: brief.origin,
          destination: brief.destination,
          date: brief.departureDate,
          travellers: brief.travellers,
        }),
        this.searchHotelsTool.execute({
          destination: brief.destination,
          checkIn: brief.departureDate,
          checkOut: brief.returnDate ?? brief.departureDate,
          guests: brief.travellers,
        }),
        this.searchActivitiesTool.execute({
          destination: brief.destination,
          startDate: brief.departureDate,
          endDate: brief.returnDate ?? brief.departureDate,
          interests: brief.interests,
        }),
      ]);

      // Each tool returns { result: string (compressed JSON), savings: {...} }
      // Parse once here — these are the RTK-compressed domain objects.
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

      // Build tool call log entries with before/after RTK savings
      const toolCallLog: ToolCallEntry[] = [];

      if (flightsRes.status === "fulfilled") {
        toolCallLog.push({
          tool: "search_flights",
          input: { origin: brief.origin, destination: brief.destination },
          output: flightsRes.value.result,
          timestamp,
          tokensBeforeRTK: Math.round(flightsRes.value.savings.beforeBytes / 4),
          tokensAfterRTK: Math.round(flightsRes.value.savings.afterBytes / 4),
        });
      }

      if (hotelsRes.status === "fulfilled") {
        toolCallLog.push({
          tool: "search_hotels",
          input: { destination: brief.destination },
          output: hotelsRes.value.result,
          timestamp,
          tokensBeforeRTK: Math.round(hotelsRes.value.savings.beforeBytes / 4),
          tokensAfterRTK: Math.round(hotelsRes.value.savings.afterBytes / 4),
        });
      }

      if (activitiesRes.status === "fulfilled") {
        toolCallLog.push({
          tool: "search_activities",
          input: { destination: brief.destination },
          output: activitiesRes.value.result,
          timestamp,
          tokensBeforeRTK: Math.round(
            activitiesRes.value.savings.beforeBytes / 4,
          ),
          tokensAfterRTK: Math.round(
            activitiesRes.value.savings.afterBytes / 4,
          ),
        });
      }

      // Aggregate token savings across all three searches
      const totalBeforeTokens = toolCallLog.reduce(
        (sum, tc) => sum + (tc.tokensBeforeRTK ?? 0),
        0,
      );
      const totalAfterTokens = toolCallLog.reduce(
        (sum, tc) => sum + (tc.tokensAfterRTK ?? 0),
        0,
      );

      await this.tokenTracker.trackCall({
        sessionId: state.sessionId,
        nodeName: "search_orchestrator",
        model: "tool_calls_only", // No LLM call — pure parallel API + compression
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
            thought: `Parallel search complete. ${flights.length} flights | ${hotels.length} hotels | ${activities.length} activities. RTK compression saved ${totalBeforeTokens - totalAfterTokens} tokens.`,
            timestamp,
          },
        ],
      };
    } catch (err) {
      return {
        errors: [`Parallel search failed: ${(err as any).message}`],
        status: "error",
      };
    }
  }

  // ── Node: Itinerary Assembler ──────────────────────────────────────────────
  /**
   * Assembles flight/hotel/activity options into a structured Itinerary via LLM.
   *
   * RTK layer: the LLM receives already-compressed search results (from
   * search_orchestrator). The assembled itinerary JSON is then passed through
   * the generic compressor to produce a compact context snapshot stored in
   * `compressedContext` for use by downstream nodes.
   */
  private async nodeItineraryAssembler(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    try {
      const itinerary = await this.assembleItineraryTool.execute({
        brief: state.parsedBrief,
        flightOptions: state.flightOptions,
        hotelOptions: state.hotelOptions,
        activityOptions: state.activityOptions,
      });

      // RTK layer: compress the assembled itinerary for context window use.
      // Full itinerary object stays in state; compressed snapshot goes into
      // compressedContext so subsequent LLM calls don't receive the full payload.
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
        outputTokens: {
          total: Math.ceil(compressed.afterBytes / 4),
        },
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
            thought: `Itinerary assembled. Total cost: ${itinerary.totalCost}. Context compressed from ${compressed.beforeBytes}B → ${compressed.afterBytes}B (${Math.round((1 - compressed.afterBytes / compressed.beforeBytes) * 100)}% reduction).`,
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
   * Runs rule-based conflict detection, then resolves the highest-priority
   * unresolved conflict one iteration at a time (loop guard: max 5).
   *
   * RTK layer: the LLM receives a compressed itinerary context rather than
   * the full JSON. The conflict object itself is small and sent verbatim.
   */
  private async nodeConflictResolver(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    if (!state.itinerary) {
      return {
        status: "error",
        errors: ["No itinerary found for conflict resolution."],
      };
    }

    // Step 1: Deterministic rule-based detection (no LLM cost)
    const detection = await this.detectConflictsTool.execute({
      itinerary: state.itinerary,
    });
    const conflictsList = detection.conflicts;

    const unresolved = conflictsList.filter(
      (c) => !state.resolvedConflicts.some((r) => r.conflictId === c.id),
    );

    if (unresolved.length === 0) {
      this.logger.log("Itinerary is clean. No unresolved conflicts found.");
      return {
        conflicts: conflictsList,
        currentNode: "conflict_resolver",
        status: "done",
      };
    }

    // Step 2: Resolve highest-priority conflict
    const activeConflict = unresolved[0];
    this.logger.log(
      `Resolving conflict [${activeConflict.conflictType}]: ${activeConflict.description}`,
    );

    try {
      const resolution = await this.resolveConflictTool.execute({
        conflict: activeConflict,
        itinerary: state.itinerary,
        resolutionStrategy:
          activeConflict.conflictType === "BUDGET_EXCEEDED"
            ? "replace_hotel"
            : "adjust_times",
      });

      // Compress the updated itinerary for the context window
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
        outputTokens: {
          total: Math.ceil(compressed.afterBytes / 4),
        },
        latencyMs: Date.now() - t0,
      });

      const resolvedObj = {
        conflictId: activeConflict.id,
        action:
          activeConflict.conflictType === "BUDGET_EXCEEDED"
            ? "replace_hotel"
            : "adjust_time",
        explanation: resolution.explanation,
        updatedSegmentIds: activeConflict.affectedItems,
      } as any;

      return {
        itinerary: resolution.itinerary,
        compressedContext: compressed.compressed,
        conflicts: conflictsList,
        resolvedConflicts: [resolvedObj], // Reducer will concat
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
   * Processes post-booking change events (flight delay/cancellation/date change)
   * and propagates downstream effects to identify new conflicts.
   *
   * RTK layer: The change event and affected delta are sent rather than the
   * full itinerary. Token tracking captures the savings vs naive full-history.
   */
  private async nodeChangeManager(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    if (!state.changeRequest || !state.itinerary) {
      return {
        currentNode: "change_manager",
        status: "error",
        errors: ["Missing changeRequest or itinerary in change_manager."],
      };
    }

    const { changeType, affectedBookingRef, newDetails } = state.changeRequest;
    this.logger.log(
      `Change Manager: Processing [${changeType}] for ref ${affectedBookingRef}`,
    );

    try {
      let affectedSegmentIds: string[] = [];
      const updatedItinerary = { ...state.itinerary };

      // ── Identify which segment changed ────────────────────────────────────
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
            `Flight with booking ref ${affectedBookingRef} not found in itinerary.`,
          );
        }

        const newTime = newDetails?.newTime as string | undefined;

        const flightChangeRes = await this.handleFlightChangeTool.execute({
          itinerary: updatedItinerary,
          segmentId: flightSegmentId,
          changeType:
            changeType === "flight_delay"
              ? "delay"
              : changeType === "flight_cancellation"
                ? "cancellation"
                : "date_change",
          newTime,
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
            `Hotel with booking ref ${affectedBookingRef} not found in itinerary.`,
          );
        }
      }

      // ── Propagate downstream impact ───────────────────────────────────────
      const propagationRes = await this.propagateDownstreamTool.execute({
        itinerary: updatedItinerary,
        changedSegmentId: affectedBookingRef,
        affectedSegmentIds,
      });

      // RTK layer: compress the delta context (affected segments only)
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
            thought: `Processed [${changeType}] for ref ${affectedBookingRef}. Affected segments: [${affectedSegmentIds.join(", ")}]. ${propagationRes.conflicts.length} downstream conflicts detected.`,
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
  /** Terminal node — marks the graph run as complete. */
  private async nodeResponder(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const timestamp = new Date().toISOString();
    return {
      currentNode: "responder",
      status: "done",
      thoughtLog: [
        {
          nodeName: "responder",
          thought: "Graph execution complete. Itinerary is ready.",
          timestamp,
        },
      ],
    };
  }

  // ── Public execution entry-point ───────────────────────────────────────────
  async execute(
    initialState: Partial<StateAnnotationType>,
  ): Promise<StateAnnotationType> {
    if (!this.graph) {
      throw new Error("Graph is not compiled.");
    }

    this.logger.log(
      `Executing trip planning graph for session: ${initialState.sessionId}`,
    );

    const inputs: Partial<StateAnnotationType> = {
      sessionId: initialState.sessionId,
      tripId: initialState.tripId,
      userId: initialState.userId,
      rawBrief: initialState.rawBrief,
      changeRequest: initialState.changeRequest ?? null,
      itinerary: initialState.itinerary ?? null,
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
