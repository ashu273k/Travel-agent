import { describe, it, expect, vi } from "vitest";
import { HandleFlightChangeTool } from "../../src/modules/agent/tools/changes/handle-flight-change.tool";
import { PropagateDownstreamTool } from "../../src/modules/agent/tools/changes/propagate-downstream.tool";
import { Itinerary } from "../../src/common/types/travel.types";
import { TripStatus } from "@prisma/client";

describe("Change Tools", () => {
  const baseItinerary: Itinerary = {
    id: "itin-123",
    status: TripStatus.PLANNING,
    totalCost: 150000,
    createdAt: "2026-06-18",
    brief: {
      origin: "BOM",
      destination: "Paris",
      departureDate: "2026-08-15",
      travellers: 2,
      budgetMin: 100000,
      budgetMax: 300000,
      currency: "INR",
      accommodationPrefs: [],
      specialRequirements: [],
      interests: [],
    },
    outboundFlight: {
      id: "f-out",
      airline: "AI",
      flightNumber: "AI-101",
      origin: "BOM",
      destination: "CDG",
      departTime: "2026-08-15T08:00:00Z",
      arriveTime: "2026-08-15T14:30:00Z",
      durationMins: 630,
      stops: 0,
      pricePerPerson: 40000,
      totalPrice: 80000,
      bookingRef: "REF-OUT",
      status: "scheduled",
    },
    returnFlight: {
      id: "f-ret",
      airline: "AI",
      flightNumber: "AI-102",
      origin: "CDG",
      destination: "BOM",
      departTime: "2026-08-20T10:00:00Z",
      arriveTime: "2026-08-21T10:00:00Z",
      durationMins: 540,
      stops: 0,
      pricePerPerson: 40000,
      totalPrice: 80000,
      bookingRef: "REF-RET",
      status: "scheduled",
    },
    hotel: {
      id: "hotel",
      name: "Pullman",
      address: "Suffren",
      stars: 4,
      checkIn: "2026-08-15",
      checkOut: "2026-08-20",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      pricePerNight: 10000,
      totalPrice: 50000,
      bookingRef: "REF-HOTEL",
      coordinates: { lat: 48.8, lng: 2.2 },
      amenities: [],
    },
    activities: [],
    days: [],
  };

  const handleFlightChangeTool = new HandleFlightChangeTool();

  it("should process flight delay and recalculate departure and arrival", async () => {
    const result = await handleFlightChangeTool.execute({
      itinerary: baseItinerary,
      segmentId: "f-out",
      changeType: "delay",
      newTime: "2026-08-15T12:00:00Z",
    });

    expect(result.affectedSegmentIds).toContain("f-out");
    expect(result.updatedFlight?.status).toBe("delayed");
    expect(result.updatedFlight?.departTime).toBe("2026-08-15T12:00:00Z");
    expect(result.updatedFlight?.arriveTime).toBe(
      new Date(
        new Date("2026-08-15T12:00:00Z").getTime() + 630 * 60 * 1000,
      ).toISOString(),
    );
  });

  it("should process flight cancellation and cascade to downstream dependencies", async () => {
    const result = await handleFlightChangeTool.execute({
      itinerary: baseItinerary,
      segmentId: "f-out",
      changeType: "cancellation",
    });

    expect(result.affectedSegmentIds).toContain("f-out");
    expect(result.affectedSegmentIds).toContain("hotel");
    expect(result.updatedFlight?.status).toBe("cancelled");
  });

  it("should detect conflicts on updated segments using propagateDownstream", async () => {
    const mockDetectConflictsTool = {
      execute: vi.fn().mockResolvedValue({
        conflicts: [
          {
            id: "c1",
            conflictType: "CHECK_IN_BEFORE_LANDING",
            severity: "warning",
            affectedItems: ["f-out", "hotel"],
            description: "Test description",
            suggestedFix: "Fix",
          },
        ],
      }),
    };

    const propagateDownstreamTool = new PropagateDownstreamTool(
      mockDetectConflictsTool as any,
    );

    const result = await propagateDownstreamTool.execute({
      itinerary: baseItinerary,
      changedSegmentId: "REF-OUT",
      affectedSegmentIds: ["f-out", "hotel"],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictType).toBe("CHECK_IN_BEFORE_LANDING");
  });
});
