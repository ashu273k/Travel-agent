import { describe, it, expect } from "vitest";
import { HandleFlightChangeTool } from "../../src/modules/agent/tools/changes/handle-flight-change.tool";
import { PropagateDownstreamTool } from "../../src/modules/agent/tools/changes/propagate-downstream.tool";
import { DetectConflictsTool } from "../../src/modules/agent/tools/planning/detect-conflicts.tool";
import { Itinerary } from "../../src/common/types/travel.types";
import { TripStatus } from "@prisma/client";

describe("Change Propagation Eval", () => {
  const handleFlightChangeTool = new HandleFlightChangeTool();
  const detectConflictsTool = new DetectConflictsTool();
  const propagateDownstreamTool = new PropagateDownstreamTool(
    detectConflictsTool,
  );

  const mockItinerary: Itinerary = {
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
      name: "Pullman Eiffel",
      address: "18 Ave Suffren",
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
    activities: [
      {
        id: "act-1",
        name: "Eiffel Tower Visit",
        type: "attraction",
        date: "2026-08-16",
        startTime: "2026-08-16T10:00:00Z",
        endTime: "2026-08-16T12:00:00Z",
        durationMins: 120,
        cost: 2500,
        location: "Eiffel Tower",
        bookingRequired: true,
        notes: "",
      },
    ],
    days: [],
  };

  it("should propagate cancellation to downstream dependencies and detect hotel gap", async () => {
    const itinerary = JSON.parse(JSON.stringify(mockItinerary));
    const flightChangeRes = await handleFlightChangeTool.execute({
      itinerary,
      segmentId: "f-out",
      changeType: "cancellation",
    });

    expect(flightChangeRes.affectedSegmentIds).toContain("f-out");
    expect(flightChangeRes.affectedSegmentIds).toContain("hotel");
    expect(flightChangeRes.affectedSegmentIds).toContain("act-1");
    expect(flightChangeRes.affectedSegmentIds).toContain("f-ret");

    if (flightChangeRes.updatedFlight) {
      itinerary.outboundFlight = flightChangeRes.updatedFlight;
    }
    itinerary.hotel = undefined;

    const propRes = await propagateDownstreamTool.execute({
      itinerary,
      changedSegmentId: "REF-OUT",
      affectedSegmentIds: flightChangeRes.affectedSegmentIds,
    });

    expect(propRes.conflicts.some((c) => c.conflictType === "HOTEL_GAP")).toBe(
      true,
    );
  });
});
