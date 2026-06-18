import { describe, it, expect, beforeEach, vi } from "vitest";
import { TravelGraphService } from "../../src/modules/agent/graph/travel-graph";
import { TripStatus } from "@prisma/client";

describe("TravelGraphService E2E state machine", () => {
  let travelGraphService: TravelGraphService;

  // Mock dependencies
  const mockLlmService = {
    complete: vi.fn(),
  };

  const mockTokenTracker = {
    trackCall: vi.fn(),
  };

  const mockCompressor = {
    compressToolResult: vi.fn(),
  };

  const mockContextManager = {
    buildCachedPayload: vi.fn(),
    buildSlidingWindowContext: vi.fn(),
  };

  const mockSearchFlightsTool = {
    execute: vi.fn().mockResolvedValue({
      result: JSON.stringify([
        {
          id: "f1",
          airline: "AI",
          flightNumber: "AI-101",
          pricePerPerson: 30000,
          totalPrice: 60000,
        },
      ]),
      savings: { beforeBytes: 1000, afterBytes: 100, rtkUsed: false },
    }),
  };

  const mockSearchHotelsTool = {
    execute: vi.fn().mockResolvedValue({
      result: JSON.stringify([
        {
          id: "h1",
          name: "Mock Hotel",
          stars: 4,
          pricePerNight: 8000,
          totalPrice: 40000,
        },
      ]),
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

  beforeEach(() => {
    // Reset all mock implementations
    vi.resetAllMocks();

    // Re-establish mock implementations after reset
    mockCompressor.compressToolResult.mockResolvedValue({
      compressed: JSON.stringify({ id: "mock-itin", totalCost: 100000 }),
      beforeBytes: 5000,
      afterBytes: 200,
      rtkUsed: false,
    });

    mockContextManager.buildCachedPayload.mockReturnValue({
      systemPrompt: "You are an expert Travel Constraint Extractor.",
      userPrompt: "Current state: parsing",
    });
    mockContextManager.buildSlidingWindowContext.mockReturnValue("");

    // Set up mock implementations for LLM
    mockLlmService.complete.mockImplementation((nodeName, messages) => {
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

    mockSearchFlightsTool.execute.mockResolvedValue({
      result: JSON.stringify([
        {
          id: "f1",
          airline: "AI",
          flightNumber: "AI-101",
          pricePerPerson: 30000,
          totalPrice: 60000,
        },
      ]),
      savings: { beforeBytes: 1000, afterBytes: 100, rtkUsed: false },
    });

    mockSearchHotelsTool.execute.mockResolvedValue({
      result: JSON.stringify([
        {
          id: "h1",
          name: "Mock Hotel",
          stars: 4,
          pricePerNight: 8000,
          totalPrice: 40000,
        },
      ]),
      savings: { beforeBytes: 1000, afterBytes: 100, rtkUsed: false },
    });

    mockSearchActivitiesTool.execute.mockResolvedValue({
      result: JSON.stringify([{ id: "a1", name: "Mock Tour", cost: 3000 }]),
      savings: { beforeBytes: 1000, afterBytes: 100, rtkUsed: false },
    });

    mockAssembleItineraryTool.execute.mockResolvedValue({
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
    });

    mockDetectConflictsTool.execute.mockResolvedValue({ conflicts: [] });

    travelGraphService = new TravelGraphService(
      mockLlmService as any,
      mockTokenTracker as any,
      mockCompressor as any,
      mockContextManager as any,
      mockSearchFlightsTool as any,
      mockSearchHotelsTool as any,
      mockSearchActivitiesTool as any,
      mockAssembleItineraryTool as any,
      mockDetectConflictsTool as any,
      mockResolveConflictTool as any,
      mockHandleFlightChangeTool as any,
      mockPropagateDownstreamTool as any,
    );
  });

  it("should successfully run the state machine from parsing to search to done", async () => {
    const finalState = await travelGraphService.execute({
      sessionId: "sess-123",
      tripId: "trip-123",
      userId: "user-123",
      rawBrief:
        "5 days in Paris from Mumbai for 2 people starting August 15th, budget 2 lakhs",
    });

    // Verify it completed
    console.log("FINAL STATE ERRORS:", finalState.errors);
    expect(finalState.status).toBe("done");
    expect(finalState.currentNode).toBe("responder");
    expect(finalState.errors).toHaveLength(0);

    // Verify constraints extracted
    expect(finalState.parsedBrief).not.toBeNull();
    expect(finalState.parsedBrief?.destination).toBe("Paris, France");

    // Verify search triggered
    expect(mockSearchFlightsTool.execute).toHaveBeenCalled();
    expect(mockSearchHotelsTool.execute).toHaveBeenCalled();

    // Verify itinerary assembled
    expect(finalState.itinerary).not.toBeNull();
    expect(finalState.itinerary?.totalCost).toBe(100000);
  });
});
