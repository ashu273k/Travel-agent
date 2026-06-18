import { describe, it, expect, vi } from "vitest";
import { TravelGraphService } from "../../src/modules/agent/graph/travel-graph";
import { TripStatus } from "@prisma/client";

describe("Token Budget Eval", () => {
  const mockLlmService = {
    complete: vi.fn(),
  };

  const mockTokenTracker = {
    trackCall: vi.fn().mockResolvedValue(undefined),
  };

  const mockCompressor = {
    compressToolResult: vi.fn(),
  };

  const mockContextManager = {
    buildCachedPayload: vi.fn(),
    buildSlidingWindowContext: vi.fn(),
  };

  const mockTemplateService = {
    findSimilar: vi.fn().mockResolvedValue(null),
    saveTemplate: vi.fn().mockResolvedValue(undefined),
  };

  const mockSemanticCache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  };

  const mockSseService = {
    emit: vi.fn(),
  };

  const mockQueueService = {
    registerJobHandler: vi.fn(),
    addJob: vi.fn().mockResolvedValue("mock-job-id"),
  };

  const mockSearchFlightsTool = {
    execute: vi.fn().mockResolvedValue({
      result: JSON.stringify([
        { id: "f1", pricePerPerson: 30000, totalPrice: 60000 },
      ]),
      savings: { beforeBytes: 1000, afterBytes: 100, rtkUsed: false },
    }),
  };

  const mockSearchHotelsTool = {
    execute: vi.fn().mockResolvedValue({
      result: JSON.stringify([{ id: "h1", stars: 4, totalPrice: 40000 }]),
      savings: { beforeBytes: 1000, afterBytes: 100, rtkUsed: false },
    }),
  };

  const mockSearchActivitiesTool = {
    execute: vi.fn().mockResolvedValue({
      result: JSON.stringify([{ id: "a1", name: "Mock Tour", cost: 3000 }]),
      savings: { beforeBytes: 1000, afterBytes: 100, rtkUsed: false },
    }),
  };

  const mockAssembleItineraryTool = {
    execute: vi.fn().mockResolvedValue({
      id: "mock-itin-id",
      brief: {},
      outboundFlight: { id: "f1", pricePerPerson: 30000, totalPrice: 60000 },
      hotel: {
        id: "h1",
        pricePerNight: 8000,
        totalPrice: 40000,
        checkInTime: "15:00",
      },
      activities: [],
      days: [],
      totalCost: 100000,
      status: TripStatus.PLANNING,
    }),
  };

  const mockDetectConflictsTool = {
    execute: vi.fn().mockResolvedValue({ conflicts: [] }),
  };

  const mockResolveConflictTool = {
    execute: vi.fn(),
  };

  const mockHandleFlightChangeTool = {
    execute: vi.fn(),
  };

  const mockPropagateDownstreamTool = {
    execute: vi.fn(),
  };

  it("should execute graph and verify token budget limits are not exceeded", async () => {
    mockCompressor.compressToolResult.mockResolvedValue({
      compressed: JSON.stringify({ id: "mock-itin", totalCost: 100000 }),
      beforeBytes: 5000,
      afterBytes: 200,
      rtkUsed: false,
    });

    mockContextManager.buildCachedPayload.mockReturnValue({
      systemPrompt: "System rules",
      userPrompt: "Current state",
    });
    mockContextManager.buildSlidingWindowContext.mockReturnValue("");

    mockLlmService.complete.mockImplementation((nodeName) => {
      if (nodeName === "intent-parser") {
        return Promise.resolve(
          JSON.stringify({
            origin: "BOM",
            destination: "Paris, France",
            departureDate: "2026-08-15",
            returnDate: "2026-08-20",
            travellers: 2,
            budgetMin: 80000,
            budgetMax: 200000,
            currency: "INR",
            accommodationPrefs: [],
            specialRequirements: [],
            interests: [],
          }),
        );
      }
      return Promise.resolve("Mock reply");
    });

    const graph = new TravelGraphService(
      mockLlmService as any,
      mockTokenTracker as any,
      mockCompressor as any,
      mockContextManager as any,
      mockTemplateService as any,
      mockSemanticCache as any,
      mockSseService as any,
      mockQueueService as any,
      mockSearchFlightsTool as any,
      mockSearchHotelsTool as any,
      mockSearchActivitiesTool as any,
      mockAssembleItineraryTool as any,
      mockDetectConflictsTool as any,
      mockResolveConflictTool as any,
      mockHandleFlightChangeTool as any,
      mockPropagateDownstreamTool as any,
    );

    graph.onModuleInit();

    await graph.execute({
      sessionId: "sess-budget",
      tripId: "trip-budget",
      userId: "user-budget",
      rawBrief: "5 days in Paris from Mumbai for 2 people",
    });

    expect(mockTokenTracker.trackCall).toHaveBeenCalled();

    const budgets: Record<string, number> = {
      intent_parser: 2500,
      search_orchestrator: 5000,
      itinerary_assembler: 5000,
      conflict_resolver: 5000,
      change_manager: 5000,
    };

    let grandTotal = 0;
    const calls = mockTokenTracker.trackCall.mock.calls;

    for (const [telemetry] of calls) {
      const { nodeName, inputTokens } = telemetry;
      const budget = budgets[nodeName];
      if (budget !== undefined) {
        expect(inputTokens.total).toBeLessThan(budget);
      }
      grandTotal += inputTokens.total + telemetry.outputTokens.total;
    }

    expect(grandTotal).toBeLessThan(15000);
  });
});
