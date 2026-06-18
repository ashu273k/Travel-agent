import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { Itinerary, Flight } from "../../../../common/types/travel.types";
import { ItineraryUtils } from "../../../../common/utils/itinerary.utils";

export const HandleFlightChangeInputSchema = z.object({
  itinerary: z.any().describe("The active itinerary object"),
  segmentId: z
    .string()
    .describe("The flight segment ID to change (e.g., f-out or f-ret)"),
  changeType: z
    .enum(["delay", "cancellation", "date_change"])
    .describe("The type of change"),
  newTime: z
    .string()
    .optional()
    .describe("ISO datetime if delayed or date_changed"),
});

export type HandleFlightChangeInput = z.infer<
  typeof HandleFlightChangeInputSchema
>;

@Injectable()
export class HandleFlightChangeTool {
  private readonly logger = new Logger(HandleFlightChangeTool.name);

  readonly name = "handle_flight_change";
  readonly description =
    "Processes flight delay/cancellation/date change, updates segment status, and returns affected segment IDs.";
  readonly inputSchema = HandleFlightChangeInputSchema;

  async execute(input: {
    itinerary: Itinerary;
    segmentId: string;
    changeType: "delay" | "cancellation" | "date_change";
    newTime?: string;
  }): Promise<{ affectedSegmentIds: string[]; updatedFlight: Flight | null }> {
    const { itinerary, segmentId, changeType, newTime } = input;
    this.logger.log(
      `Handling flight change: ${changeType} on segment ${segmentId}`,
    );

    const flight = ItineraryUtils.getFlight(itinerary, segmentId);

    if (!flight) {
      this.logger.warn(`Flight segment ${segmentId} not found in itinerary`);
      return { affectedSegmentIds: [], updatedFlight: null };
    }

    const updatedFlight: Flight = { ...flight };
    const affectedSegmentIds: string[] = [segmentId];
    const isOutbound = itinerary.outboundFlight?.id === segmentId;

    if (changeType === "cancellation") {
      updatedFlight.status = "cancelled";
      if (isOutbound) {
        if (itinerary.hotel) affectedSegmentIds.push(itinerary.hotel.id);
        itinerary.activities.forEach((act) => affectedSegmentIds.push(act.id));
        if (itinerary.returnFlight)
          affectedSegmentIds.push(itinerary.returnFlight.id);
      }
    } else if (changeType === "delay" || changeType === "date_change") {
      updatedFlight.status = changeType === "delay" ? "delayed" : "scheduled";
      if (newTime) {
        updatedFlight.departTime = newTime;
        const departDate = new Date(newTime);
        const arriveDate = new Date(
          departDate.getTime() + updatedFlight.durationMins * 60 * 1000,
        );
        updatedFlight.arriveTime = arriveDate.toISOString();
      }
    }

    return { affectedSegmentIds, updatedFlight };
  }
}
