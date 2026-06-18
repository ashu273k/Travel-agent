import { describe, it, expect } from "vitest";
import { DetectConflictsTool } from "../../src/modules/agent/tools/planning/detect-conflicts.tool";
import { Itinerary } from "../../src/common/types/travel.types";
import { TripStatus } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

describe("Conflict Detection Eval", () => {
  const detectConflictsTool = new DetectConflictsTool();
  const conflictsPath = path.join(
    __dirname,
    "../fixtures/planted-conflicts.json",
  );
  const conflictsFixture = JSON.parse(fs.readFileSync(conflictsPath, "utf8"));

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

  it("should detect planted conflicts", async () => {
    for (const scenario of conflictsFixture) {
      const itin: Itinerary = JSON.parse(JSON.stringify(baseItinerary));
      if (scenario.removeHotel) {
        itin.hotel = undefined;
      }
      if (scenario.activities) {
        itin.activities = scenario.activities as any;
      }
      if (scenario.briefPatch) {
        itin.brief = { ...itin.brief, ...scenario.briefPatch };
      }
      if (scenario.itineraryPatch) {
        if (scenario.itineraryPatch.outboundFlight) {
          itin.outboundFlight = {
            ...itin.outboundFlight!,
            ...scenario.itineraryPatch.outboundFlight,
          };
        }
        if (scenario.itineraryPatch.hotel) {
          itin.hotel = {
            ...itin.hotel!,
            ...(scenario.itineraryPatch.hotel as any),
          };
        }
        if (scenario.itineraryPatch.returnFlight) {
          itin.returnFlight = {
            ...itin.returnFlight!,
            ...scenario.itineraryPatch.returnFlight,
          };
        }
      }

      const { conflicts } = await detectConflictsTool.execute({
        itinerary: itin,
      });
      expect(
        conflicts.some((c) => c.conflictType === scenario.conflictType),
      ).toBe(true);
    }
  });
});
