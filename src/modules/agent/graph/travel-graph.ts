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

import { SearchFlightsTool } from "../tools/search/search-flights.tool";
import { SearchHotelsTool } from "../tools/search/search-hotels.tool";
import { SearchActivitiesTool } from "../tools/search/search-activities.tool";
import { AssembleItineraryTool } from "../tools/planning/assemble-itinerary.tool";
import { DetectConflictsTool } from "../tools/planning/detect-conflicts.tool";
import { ResolveConflictTool } from "../tools/planning/resolve-conflict.tool";
import { HandleFlightChangeTool } from "../tools/changes/handle-flight-change.tool";
import { PropagateDownstreamTool } from "../tools/changes/propagate-downstream.tool";

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

  onModuleInit() {
    this.registerBullMQHandlers();
    this.buildGraph();
  }

  private registerBullMQHandlers() {
    this.queueService.registerJobHandler("search:flights", (data) =>
      this.searchFlightsTool.execute(data),
    );
    this.queueService.registerJobHandler("search:hotels", (data) =>
      this.searchHotelsTool.execute(data),
    );
    this.queueService.registerJobHandler("search:activities", (data) =>
      this.searchActivitiesTool.execute(data),
    );
  }

  private buildGraph() {
    const graphBuilder = new StateGraph(StateAnnotation);

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

    graphBuilder.addConditionalEdges("__start__" as any, (state) => {
      if (state.changeRequest) return "change_manager";
      return "template_fast_path";
    });

    graphBuilder.addConditionalEdges("template_fast_path" as any, (state) => {
      if (state.itinerary) return "conflict_resolver";
      return "intent_parser";
    });

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
  }

  private startNode(state: StateAnnotationType, nodeName: string) {
    this.sseService.emit(state.sessionId, "graph:node_start", {
      node: nodeName,
    });
  }

  private async nodeTemplateFastPath(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    this.startNode(state, "template_fast_path");
    if (!state.parsedBrief) return { currentNode: "template_fast_path" };

    const template = await this.templateService.findSimilar(state.parsedBrief);
    if (template) {
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
            thought: `Template fast-path hit.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    return { currentNode: "template_fast_path" };
  }

  private async nodeIntentParser(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    this.startNode(state, "intent_parser");

    const { systemPrompt, userPrompt } = this.contextManager.buildCachedPayload(
      state as any,
      `You are an expert Travel Constraint Extractor. Extract structured constraints from the brief. Return ONLY JSON.`,
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
        model: "claude-haiku",
        inputTokens: {
          prefix: 1500,
          compressedAPIs: 0,
          sessionState: 100,
          userRequest: Math.ceil((state.rawBrief?.length ?? 0) / 4),
          historyWindow: 0,
          total: 1600,
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
            thought: `Parsed brief.`,
            timestamp: new Date().toISOString(),
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

  private async nodeSearchOrchestrator(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    this.startNode(state, "search_orchestrator");

    if (!state.parsedBrief)
      return { status: "error", errors: ["Missing brief."] };
    const brief = state.parsedBrief;

    const flightKey = `flights:${brief.origin}:${brief.destination}:${brief.departureDate}`;
    const hotelKey = `hotels:${brief.destination}:${brief.departureDate}:${brief.returnDate}`;
    const actsKey = `activities:${brief.destination}:${brief.departureDate}`;

    const [cachedFlights, cachedHotels, cachedActs] = await Promise.all([
      this.semanticCache.get<any[]>(flightKey),
      this.semanticCache.get<any[]>(hotelKey),
      this.semanticCache.get<any[]>(actsKey),
    ]);

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
      cachedActs
        ? Promise.resolve({
            result: JSON.stringify(cachedActs),
            savings: { beforeBytes: 0, afterBytes: 0, rtkUsed: false },
          })
        : this.searchActivitiesTool.execute({
            destination: brief.destination,
            startDate: brief.departureDate,
            endDate: brief.returnDate ?? brief.departureDate,
            interests: brief.interests,
          }),
    ]);

    const flights =
      flightsRes.status === "fulfilled"
        ? JSON.parse(flightsRes.value.result)
        : [];
    const hotels =
      hotelsRes.status === "fulfilled"
        ? JSON.parse(hotelsRes.value.result)
        : [];
    const activities =
      activitiesRes.status === "fulfilled"
        ? JSON.parse(activitiesRes.value.result)
        : [];

    const toolCallLog: ToolCallEntry[] = [];
    const timestamp = new Date().toISOString();

    const addLog = (tool: string, res: any) => {
      if (res.status === "fulfilled") {
        toolCallLog.push({
          tool,
          input: {},
          output: res.value.result,
          timestamp,
          tokensBeforeRTK: Math.round((res.value.savings.beforeBytes || 0) / 4),
          tokensAfterRTK: Math.round((res.value.savings.afterBytes || 0) / 4),
        });
      }
    };

    addLog("search_flights", flightsRes);
    addLog("search_hotels", hotelsRes);
    addLog("search_activities", activitiesRes);

    const totalAfter = toolCallLog.reduce(
      (s, tc) => s + (tc.tokensAfterRTK || 0),
      0,
    );

    if (!cachedFlights && flights.length > 0)
      this.semanticCache.set(flightKey, flights, 4).catch(() => {});
    if (!cachedHotels && hotels.length > 0)
      this.semanticCache.set(hotelKey, hotels, 4).catch(() => {});
    if (!cachedActs && activities.length > 0)
      this.semanticCache.set(actsKey, activities, 4).catch(() => {});

    await this.tokenTracker.trackCall({
      sessionId: state.sessionId,
      nodeName: "search_orchestrator",
      model: "tool_calls",
      inputTokens: {
        prefix: 0,
        compressedAPIs: totalAfter,
        sessionState: 150,
        userRequest: 0,
        historyWindow: 0,
        total: totalAfter + 150,
      },
      outputTokens: { total: 0 },
      latencyMs: Date.now() - t0,
    });

    this.sseService.emit(state.sessionId, "graph:search_complete", {
      flightCount: flights.length,
      hotelCount: hotels.length,
      activityCount: activities.length,
    });

    return {
      flightOptions: flights,
      hotelOptions: hotels,
      activityOptions: activities,
      toolCallLog: [...state.toolCallLog, ...toolCallLog],
      currentNode: "search_orchestrator",
      status: "assembling",
      thoughtLog: [
        {
          nodeName: "search_orchestrator",
          thought: `Search complete.`,
          timestamp,
        },
      ],
    };
  }

  private async nodeItineraryAssembler(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    this.startNode(state, "itinerary_assembler");
    try {
      const itinerary = await this.assembleItineraryTool.execute({
        brief: state.parsedBrief,
        flightOptions: state.flightOptions,
        hotelOptions: state.hotelOptions,
        activityOptions: state.activityOptions,
      });

      const compressed = await this.compressor.compressToolResult(
        "assemble_itinerary",
        itinerary,
      );

      await this.tokenTracker.trackCall({
        sessionId: state.sessionId,
        nodeName: "itinerary_assembler",
        model: "claude-haiku",
        inputTokens: {
          prefix: 2000,
          compressedAPIs: 1000,
          sessionState: 200,
          userRequest: 0,
          historyWindow: 0,
          total: 3200,
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
            thought: `Itinerary assembled.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (err) {
      return {
        errors: [`Assembly failed: ${(err as any).message}`],
        status: "error",
      };
    }
  }

  private async nodeConflictResolver(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    this.startNode(state, "conflict_resolver");
    if (!state.itinerary) return { status: "error", errors: ["No itinerary."] };

    const { conflicts } = await this.detectConflictsTool.execute({
      itinerary: state.itinerary,
    });
    const unresolved = conflicts.filter(
      (c) => !state.resolvedConflicts.some((r) => r.conflictId === c.id),
    );

    if (unresolved.length === 0)
      return { conflicts, currentNode: "conflict_resolver", status: "done" };

    const activeConflict = unresolved[0];
    this.sseService.emit(state.sessionId, "graph:conflict_detected", {
      ...activeConflict,
    } as any);

    try {
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
        model: "claude-haiku",
        inputTokens: {
          prefix: 1800,
          compressedAPIs: 500,
          sessionState: 150,
          userRequest: 0,
          historyWindow: 0,
          total: 2450,
        },
        outputTokens: { total: Math.ceil(compressed.afterBytes / 4) },
        latencyMs: Date.now() - t0,
      });

      return {
        itinerary: resolution.itinerary,
        compressedContext: compressed.compressed,
        conflicts,
        resolvedConflicts: [
          {
            conflictId: activeConflict.id,
            action:
              activeConflict.conflictType === "BUDGET_EXCEEDED"
                ? "replace_hotel"
                : "adjust_time",
            explanation: resolution.explanation,
            updatedSegmentIds: activeConflict.affectedItems,
          },
        ],
        currentNode: "conflict_resolver",
        thoughtLog: [
          {
            nodeName: "conflict_resolver",
            thought: `Resolved ${activeConflict.conflictType}.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (err) {
      return {
        errors: [`Resolution failed: ${(err as any).message}`],
        currentNode: "conflict_resolver",
      };
    }
  }

  private async nodeChangeManager(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    const t0 = Date.now();
    this.startNode(state, "change_manager");
    if (!state.changeRequest || !state.itinerary)
      return { status: "error", errors: ["Missing data."] };

    const { changeType, affectedBookingRef, newDetails } = state.changeRequest;
    try {
      let affectedSegmentIds: string[] = [];
      const updatedItinerary = { ...state.itinerary };

      if (changeType.startsWith("flight_")) {
        const flightId =
          updatedItinerary.outboundFlight?.bookingRef === affectedBookingRef
            ? updatedItinerary.outboundFlight.id
            : updatedItinerary.returnFlight?.bookingRef === affectedBookingRef
              ? updatedItinerary.returnFlight.id
              : null;
        if (!flightId) throw new Error("Flight not found.");

        const res = await this.handleFlightChangeTool.execute({
          itinerary: updatedItinerary,
          segmentId: flightId,
          changeType:
            changeType === "flight_delay"
              ? "delay"
              : changeType === "flight_cancellation"
                ? "cancellation"
                : "date_change",
          newTime: newDetails?.newTime as string,
        });
        affectedSegmentIds = res.affectedSegmentIds;
        if (res.updatedFlight) {
          if (updatedItinerary.outboundFlight?.id === flightId)
            updatedItinerary.outboundFlight = res.updatedFlight;
          else if (updatedItinerary.returnFlight?.id === flightId)
            updatedItinerary.returnFlight = res.updatedFlight;
        }
      } else if (changeType === "hotel_cancellation") {
        if (updatedItinerary.hotel?.bookingRef === affectedBookingRef) {
          affectedSegmentIds = [updatedItinerary.hotel.id];
          updatedItinerary.hotel = undefined;
        } else throw new Error("Hotel not found.");
      }

      const propagation = await this.propagateDownstreamTool.execute({
        itinerary: updatedItinerary,
        changedSegmentId: affectedBookingRef,
        affectedSegmentIds,
      });

      const compressed = await this.compressor.compressToolResult(
        "change_manager_delta",
        {
          changeType,
          affectedSegmentIds,
          newConflicts: propagation.conflicts,
        },
      );

      await this.tokenTracker.trackCall({
        sessionId: state.sessionId,
        nodeName: "change_manager",
        model: "claude-sonnet",
        inputTokens: {
          prefix: 1500,
          compressedAPIs: 400,
          sessionState: 200,
          userRequest: 100,
          historyWindow: 0,
          total: 2200,
        },
        outputTokens: { total: 400 },
        latencyMs: Date.now() - t0,
      });

      return {
        itinerary: updatedItinerary,
        affectedSegmentIds,
        compressedContext: compressed.compressed,
        conflicts: propagation.conflicts,
        currentNode: "change_manager",
        status: "resolving",
        thoughtLog: [
          {
            nodeName: "change_manager",
            thought: `Processed ${changeType}.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (err) {
      return {
        errors: [`Change failed: ${(err as any).message}`],
        status: "error",
      };
    }
  }

  private async nodeResponder(
    state: StateAnnotationType,
  ): Promise<Partial<StateAnnotationType>> {
    if (state.itinerary && state.parsedBrief && state.errors.length === 0) {
      this.templateService
        .saveTemplate(state.itinerary, state.parsedBrief)
        .catch(() => {});
    }

    this.sseService.emit(state.sessionId, "graph:complete", {
      totalCost: state.itinerary?.totalCost ?? 0,
      status: state.errors.length > 0 ? "error" : "done",
    });

    return {
      currentNode: "responder",
      status: state.errors.length > 0 ? "error" : "done",
      thoughtLog: [
        {
          nodeName: "responder",
          thought: "Done.",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  async execute(
    initialState: Partial<StateAnnotationType>,
  ): Promise<StateAnnotationType> {
    if (!this.graph) throw new Error("Graph is not compiled.");
    const inputs: Partial<StateAnnotationType> = {
      ...initialState,
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
