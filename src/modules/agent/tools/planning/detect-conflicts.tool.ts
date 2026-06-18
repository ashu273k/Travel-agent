import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { Itinerary, Conflict } from "../../../../common/types/travel.types";

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

  async execute(input: {
    itinerary: Itinerary;
  }): Promise<{ conflicts: Conflict[] }> {
    this.logger.log(
      `Running conflict detection on itinerary: ${input.itinerary.id}`,
    );
    const conflicts: Conflict[] = [];
    const { outboundFlight, returnFlight, hotel, activities, brief } =
      input.itinerary;

    if (outboundFlight && hotel) {
      try {
        const arrivalTime = new Date(outboundFlight.arriveTime);
        const checkInDate = new Date(
          `${hotel.checkIn}T${hotel.checkInTime || "14:00"}:00`,
        );
        const timeDiffMs = checkInDate.getTime() - arrivalTime.getTime();
        const minBufferMs = 2 * 60 * 60 * 1000;

        if (
          arrivalTime.getTime() > checkInDate.getTime() ||
          timeDiffMs < minBufferMs
        ) {
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

    if (
      outboundFlight &&
      outboundFlight.stops > 0 &&
      outboundFlight.durationMins > 600
    ) {
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

    if (hotel && returnFlight) {
      try {
        const checkoutDate = new Date(
          `${hotel.checkOut}T${hotel.checkOutTime || "11:00"}:00`,
        );
        const returnFlightDepart = new Date(returnFlight.departTime);
        if (returnFlightDepart.getTime() > checkoutDate.getTime()) {
          const diffHours =
            (returnFlightDepart.getTime() - checkoutDate.getTime()) /
            (1000 * 60 * 60);
          if (diffHours > 6) {
            conflicts.push({
              id: `c-checkout-flight-${Date.now()}`,
              conflictType: "CHECKOUT_BEFORE_FLIGHT",
              severity: "warning",
              affectedItems: [hotel.id, returnFlight.id],
              description: `Hotel checkout is at ${hotel.checkOutTime} but return flight does not depart until ${this.formatTime(returnFlight.departTime)}.`,
              suggestedFix:
                "Request late checkout or add a luggage storage node.",
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

    if (brief && brief.budgetMax) {
      let totalCost =
        (outboundFlight?.totalPrice || 0) +
        (returnFlight?.totalPrice || 0) +
        (hotel?.totalPrice || 0) +
        (activities?.reduce((sum, act) => sum + act.cost, 0) || 0);
      if (totalCost > brief.budgetMax) {
        conflicts.push({
          id: `c-budget-exceeded-${Date.now()}`,
          conflictType: "BUDGET_EXCEEDED",
          severity: "critical",
          affectedItems: [],
          description: `Total cost of ${totalCost} exceeds the max budget of ${brief.budgetMax}.`,
          suggestedFix: "Downgrade hotel or choose cheaper flight options.",
        });
      }
    }

    return { conflicts };
  }

  private formatTime(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }
}
