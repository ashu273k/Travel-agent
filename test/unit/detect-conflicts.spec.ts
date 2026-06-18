import { describe, it, expect } from "vitest";
import { DetectConflictsTool } from "../../src/modules/agent/tools/planning/detect-conflicts.tool";
import {
  Itinerary,
  Flight,
  Hotel,
  Activity,
} from "../../src/common/types/travel.types";
import { TripStatus } from "@prisma/client";

describe("DetectConflictsTool", () => {
  const detectConflictsTool = new DetectConflictsTool();

  const baseItinerary: Itinerary = {
    id: "itin-test",
    status: TripStatus.PLANNING,
    totalCost: 10000,
    createdAt: "2026-06-18",
    brief: {
      origin: "BOM",
      destination: "Paris",
      departureDate: "2026-08-15",
      returnDate: "2026-08-20",
      travellers: 2,
      budgetMin: 10000,
      budgetMax: 300000,
      currency: "INR",
      accommodationPrefs: [],
      specialRequirements: [],
      interests: [],
    },
    outboundFlight: {
      id: "f-out",
      airline: "Air India",
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
      airline: "Air India",
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
    activities: [],
    days: [],
  };

  it("should pass without conflicts on a well-timed itinerary", async () => {
    const { conflicts } = await detectConflictsTool.execute({
      itinerary: baseItinerary,
    });
    expect(conflicts).toHaveLength(0);
  });

  it("should detect CHECK_IN_BEFORE_LANDING when flight lands after hotel check-in time", async () => {
    const conflictingItinerary: Itinerary = {
      ...baseItinerary,
      outboundFlight: {
        ...baseItinerary.outboundFlight!,
        arriveTime: "2026-08-15T17:30:00Z", // Lands at 17:30, check-in starts at 15:00. Note: land hour is > check-in hour on same day.
      },
      hotel: {
        ...baseItinerary.hotel!,
        checkInTime: "12:00",
      },
    };

    const { conflicts } = await detectConflictsTool.execute({
      itinerary: conflictingItinerary,
    });
    expect(
      conflicts.some((c) => c.conflictType === "CHECK_IN_BEFORE_LANDING"),
    ).toBe(true);
  });

  it("should detect ACTIVITY_OVERLAP when two activities overlap in time", async () => {
    const conflictingItinerary: Itinerary = {
      ...baseItinerary,
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
        {
          id: "act-2",
          name: "Louvre Tour",
          type: "excursion",
          date: "2026-08-16",
          startTime: "2026-08-16T11:00:00Z", // Overlaps with 10:00 - 12:00
          endTime: "2026-08-16T13:00:00Z",
          durationMins: 120,
          cost: 4500,
          location: "Louvre",
          bookingRequired: true,
          notes: "",
        },
      ],
    };

    const { conflicts } = await detectConflictsTool.execute({
      itinerary: conflictingItinerary,
    });
    expect(conflicts.some((c) => c.conflictType === "ACTIVITY_OVERLAP")).toBe(
      true,
    );
  });

  it("should detect HOTEL_GAP when hotel is missing", async () => {
    const conflictingItinerary: Itinerary = {
      ...baseItinerary,
      hotel: undefined,
    };

    const { conflicts } = await detectConflictsTool.execute({
      itinerary: conflictingItinerary,
    });
    expect(conflicts.some((c) => c.conflictType === "HOTEL_GAP")).toBe(true);
  });

  it("should detect CHECKOUT_BEFORE_FLIGHT when return flight departs > 6 hours after checkout", async () => {
    const conflictingItinerary: Itinerary = {
      ...baseItinerary,
      hotel: {
        ...baseItinerary.hotel!,
        checkOutTime: "08:00", // checkout early
      },
      returnFlight: {
        ...baseItinerary.returnFlight!,
        departTime: "2026-08-20T22:00:00Z", // flight departs 14 hours later
      },
    };

    const { conflicts } = await detectConflictsTool.execute({
      itinerary: conflictingItinerary,
    });
    expect(
      conflicts.some((c) => c.conflictType === "CHECKOUT_BEFORE_FLIGHT"),
    ).toBe(true);
  });

  it("should detect BUDGET_EXCEEDED when total cost exceeds brief.budgetMax", async () => {
    const conflictingItinerary: Itinerary = {
      ...baseItinerary,
      brief: {
        ...baseItinerary.brief,
        budgetMax: 100000, // strict budget
      },
      // Flights cost 80000 + 80000 = 160000 (exceeds budget)
    };

    const { conflicts } = await detectConflictsTool.execute({
      itinerary: conflictingItinerary,
    });
    expect(conflicts.some((c) => c.conflictType === "BUDGET_EXCEEDED")).toBe(
      true,
    );
  });
});
