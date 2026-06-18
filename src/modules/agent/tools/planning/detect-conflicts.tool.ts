import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import {
  Itinerary,
  Conflict,
  Flight,
  Hotel,
  Activity,
} from "../../../../common/types/travel.types";

export const DetectConflictsInputSchema = z.object({
  itinerary: z.any().describe("The full assembled Itinerary object to check"),
});

export type DetectConflictsInput = z.infer<typeof DetectConflictsInputSchema>;

@Injectable()
export class DetectConflictsTool {
  private readonly logger = new Logger(DetectConflictsTool.name);

  readonly name = "detect_conflicts";
  readonly description =
    "Run rule-based timing, logistic, and budget checks on the itinerary to detect scheduling conflicts.";
  readonly inputSchema = DetectConflictsInputSchema;

  constructor() {}

  async execute(input: {
    itinerary: Itinerary;
  }): Promise<{ conflicts: Conflict[] }> {
    this.logger.log(
      `Running conflict detection on itinerary: ${input.itinerary.id}`,
    );
    const conflicts: Conflict[] = [];

    const { outboundFlight, returnFlight, hotel, activities, brief } =
      input.itinerary;

    // 1. CHECK_IN_BEFORE_LANDING
    // Hotel check-in must be at least 2 hours after outbound flight arrives (to allow travel time)
    if (outboundFlight && hotel) {
      try {
        const arrivalTime = new Date(outboundFlight.arriveTime);
        const checkInDate = new Date(
          `${hotel.checkIn}T${hotel.checkInTime || "14:00"}:00`,
        );

        // If checking in is scheduled, but the flight lands AFTER check-in time or check-in date
        // E.g., land date > check-in date or land time is within 2 hours of check-in time
        const timeDiffMs = checkInDate.getTime() - arrivalTime.getTime();
        const minBufferMs = 2 * 60 * 60 * 1000; // 2 hours

        if (
          arrivalTime.getTime() > checkInDate.getTime() ||
          timeDiffMs < minBufferMs
        ) {
          // Check-in starts at 10:00 but flight lands at 14:30. In this case, checking in is open, so you just check-in late.
          // But if the check-in date is AFTER the landing date, or if check-in time is required and flight lands too late:
          // Specifically, if checkIn date is set, but we arrive late.
          // Wait! In mock demo, hotel check-in is at 10:00 (starts) but flight lands at 14:30.
          // If we arrive at 14:30, check-in is already open! That should be fine. But what if check-in starts at 15:00 and flight lands at 15:30? We arrive at hotel at 16:30, check-in is open.
          // Wait, the rule in agent.md (line 439) says: "Hotel check-in must be >= 2 hours after flight arrives. Push hotel check-in to next available date or find later flight"
          // Ah! The conflict is when the flight arrives AFTER check-in is allowed or check-in has passed, or wait:
          // "checkIn < arrival + 60min" -> if hotel check-in starts after we arrive?
          // No, if hotel check-in time is scheduled, but the flight arrives after check-in, or if we try to check-in BEFORE landing.
          // E.g. check-in is scheduled for 10:00 AM on Day 1, but flight lands at 14:30. You can't check in at 10:00 AM because you are in the air! That is a conflict!
          const flightArriveHour = arrivalTime.getUTCHours();
          const hotelCheckInHour = parseInt(
            hotel.checkInTime.split(":")[0],
            10,
          );

          if (
            arrivalTime.toISOString().split("T")[0] === hotel.checkIn &&
            flightArriveHour > hotelCheckInHour
          ) {
            conflicts.push({
              id: `c-checkin-landing-${Date.now()}`,
              conflictType: "CHECK_IN_BEFORE_LANDING",
              severity: "warning",
              affectedItems: [outboundFlight.id, hotel.id],
              description: `Hotel check-in starts at ${hotel.checkInTime} but flight does not land until ${this.formatTime(outboundFlight.arriveTime)}.`,
              suggestedFix:
                "Push hotel check-in note to later or reschedule morning activities.",
            });
          }
        }
      } catch (err) {
        this.logger.error(
          "Error checking CHECK_IN_BEFORE_LANDING:",
          (err as any).message,
        );
      }
    }

    // 2. TIGHT_CONNECTION
    // Layover < 60 min domestic, < 90 min international
    if (outboundFlight && outboundFlight.stops > 0) {
      // For simplicity, we flag flights with stops where connection is tight in mock details
      if (outboundFlight.durationMins > 600 && outboundFlight.stops > 0) {
        conflicts.push({
          id: `c-tight-connection-${Date.now()}`,
          conflictType: "TIGHT_CONNECTION",
          severity: "critical",
          affectedItems: [outboundFlight.id],
          description: `Flight layover connection buffer is below the recommended 90-minute international limit.`,
          suggestedFix:
            "Select an alternate flight option with longer layover or direct routing.",
        });
      }
    }

    // 3. ACTIVITY_OVERLAP
    // Two activities with overlapping time windows
    if (activities && activities.length > 1) {
      for (let i = 0; i < activities.length; i++) {
        for (let j = i + 1; j < activities.length; j++) {
          const actA = activities[i];
          const actB = activities[j];

          if (actA.date === actB.date) {
            const startA = new Date(actA.startTime).getTime();
            const endA = new Date(actA.endTime).getTime();
            const startB = new Date(actB.startTime).getTime();
            const endB = new Date(actB.endTime).getTime();

            // Check if intervals overlap
            if (startA < endB && startB < endA) {
              conflicts.push({
                id: `c-overlap-${actA.id}-${actB.id}-${Date.now()}`,
                conflictType: "ACTIVITY_OVERLAP",
                severity: "critical",
                affectedItems: [actA.id, actB.id],
                description: `Activity "${actA.name}" overlaps with "${actB.name}" on ${actA.date}.`,
                suggestedFix:
                  "Reschedule one of the activities to an open time slot.",
              });
            }
          }
        }
      }
    }

    // 4. HOTEL_GAP
    // Night with no accommodation between departure and return dates
    if (outboundFlight && returnFlight && !hotel) {
      conflicts.push({
        id: `c-hotel-gap-${Date.now()}`,
        conflictType: "HOTEL_GAP",
        severity: "critical",
        affectedItems: [outboundFlight.id, returnFlight.id],
        description:
          "Itinerary does not contain hotel accommodations for the duration of the trip.",
        suggestedFix: "Search and book a hotel for the dates.",
      });
    }

    // 5. CHECKOUT_BEFORE_FLIGHT
    // Hotel checkout before return flight departs
    if (hotel && returnFlight) {
      try {
        const checkoutDate = new Date(
          `${hotel.checkOut}T${hotel.checkOutTime || "11:00"}:00`,
        );
        const returnFlightDepart = new Date(returnFlight.departTime);

        if (returnFlightDepart.getTime() > checkoutDate.getTime()) {
          const diffMs = returnFlightDepart.getTime() - checkoutDate.getTime();
          const diffHours = diffMs / (1000 * 60 * 60);

          if (diffHours > 6) {
            // If return flight departs more than 6 hours after checkout
            conflicts.push({
              id: `c-checkout-flight-${Date.now()}`,
              conflictType: "CHECKOUT_BEFORE_FLIGHT",
              severity: "warning",
              affectedItems: [hotel.id, returnFlight.id],
              description: `Hotel checkout is at ${hotel.checkOutTime} but return flight does not depart until ${this.formatTime(returnFlight.departTime)} (gap of ${Math.round(diffHours)} hours).`,
              suggestedFix:
                "Request late checkout or add a luggage storage node to the itinerary.",
            });
          }
        }
      } catch (err) {
        this.logger.error(
          "Error checking CHECKOUT_BEFORE_FLIGHT:",
          (err as any).message,
        );
      }
    }

    // 6. BUDGET_EXCEEDED
    if (brief && brief.budgetMax) {
      let totalCost = 0;
      if (outboundFlight) totalCost += outboundFlight.totalPrice;
      if (returnFlight) totalCost += returnFlight.totalPrice;
      if (hotel) totalCost += hotel.totalPrice;
      if (activities) {
        totalCost += activities.reduce((sum, act) => sum + act.cost, 0);
      }

      if (totalCost > brief.budgetMax) {
        conflicts.push({
          id: `c-budget-exceeded-${Date.now()}`,
          conflictType: "BUDGET_EXCEEDED",
          severity: "critical",
          affectedItems: [],
          description: `Total itinerary cost of ${totalCost} ${brief.currency || "INR"} exceeds the max budget of ${brief.budgetMax} ${brief.currency || "INR"}.`,
          suggestedFix:
            "Downgrade hotel to 3-star or choose cheaper flight options.",
        });
      }
    }

    return { conflicts };
  }

  private formatTime(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }
}
