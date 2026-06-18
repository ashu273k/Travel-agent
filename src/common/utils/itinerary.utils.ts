import { Itinerary, Flight, Hotel, Activity } from "../types/travel.types";

export class ItineraryUtils {
  static findSegment(
    itinerary: Itinerary,
    segmentId: string,
    segmentType?: "flight" | "hotel" | "activity",
  ): Flight | Hotel | Activity | null {
    if (!segmentType || segmentType === "flight") {
      if (itinerary.outboundFlight?.id === segmentId) {
        return itinerary.outboundFlight;
      }
      if (itinerary.returnFlight?.id === segmentId) {
        return itinerary.returnFlight;
      }
    }

    if (!segmentType || segmentType === "hotel") {
      if (itinerary.hotel?.id === segmentId) {
        return itinerary.hotel;
      }
    }

    if (!segmentType || segmentType === "activity") {
      return itinerary.activities?.find((a) => a.id === segmentId) ?? null;
    }

    return null;
  }

  static getFlight(itinerary: Itinerary, segmentId: string): Flight | null {
    const segment = this.findSegment(itinerary, segmentId, "flight");
    return segment as Flight | null;
  }
}
