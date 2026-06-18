import { Injectable, Logger } from "@nestjs/common";
import { QdrantService } from "./qdrant.service";
import { EmbeddingsService } from "./embeddings.service";
import { TravelBrief, Itinerary } from "../../common/types/travel.types";

/**
 * ItineraryTemplateService — L3 Itinerary Template Fast-Path
 *
 * Stores successful itineraries as reusable templates in Qdrant's
 * `itinerary_templates` collection. When a new brief is semantically similar
 * to a past successful trip, the stored template is returned instead of
 * performing a full cold search.
 *
 * Latency impact:
 *   Cold search (flights + hotels + activities): 4–6 seconds
 *   Template fast-path (Qdrant query + patch):   1–2 seconds
 *   Win when hit rate > 20%: ~2–3 second saving per booking
 *
 * Similarity threshold: 0.92 (relaxed vs semantic cache because templates
 * require more structural alignment than just a cached query result).
 *
 * Payload filters applied:
 *   - origin must match exactly
 *   - destination must match exactly
 *   - duration_days within ±1 day of requested trip length
 */
@Injectable()
export class ItineraryTemplateService {
  private readonly logger = new Logger(ItineraryTemplateService.name);

  /** Minimum cosine similarity for a template to be considered a valid match */
  private readonly SIMILARITY_THRESHOLD = 0.92;

  /** Qdrant collection name for itinerary templates */
  private readonly COLLECTION = "itinerary_templates";

  constructor(
    private readonly qdrant: QdrantService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * Check if a semantically-similar itinerary template exists for the given brief.
   * Returns the template Itinerary with dates patched to the new trip dates, or null.
   *
   * @param brief  The parsed TravelBrief for the new trip.
   * @returns      A patched template Itinerary, or null if no match found.
   */
  async findSimilar(brief: TravelBrief): Promise<Itinerary | null> {
    try {
      const queryText = this.briefToQueryString(brief);
      const vector = await this.embeddings.embedQuery(queryText);

      const hits = await this.qdrant.search(this.COLLECTION, vector, 3);

      // Filter by structural constraints AFTER vector search
      const validHit = hits.find((hit) => {
        if (hit.score < this.SIMILARITY_THRESHOLD) return false;

        const p = hit.payload as TemplatePayload;

        // Origin and destination must match exactly
        if (
          p.origin?.toLowerCase() !== brief.origin.toLowerCase() ||
          p.destination?.toLowerCase() !== brief.destination.toLowerCase()
        ) {
          return false;
        }

        // Duration must be within ±1 day
        const requestedDays = this.calculateDays(
          brief.departureDate,
          brief.returnDate,
        );
        if (Math.abs((p.durationDays ?? 0) - requestedDays) > 1) {
          return false;
        }

        return true;
      });

      if (!validHit) {
        return null;
      }

      const payload = validHit.payload as TemplatePayload;
      this.logger.log(
        `Template fast-path HIT (score=${validHit.score.toFixed(4)}) for ${brief.origin} → ${brief.destination}.`,
      );

      // Patch the template with new dates and brief reference
      return this.patchTemplateDates(
        payload.itinerary,
        brief.departureDate,
        brief.returnDate,
        brief,
      );
    } catch (err) {
      this.logger.warn(
        "Template fast-path lookup failed — falling through to cold search.",
        (err as any).message,
      );
      return null;
    }
  }

  /**
   * Store a completed itinerary as a reusable template.
   * Should be called after a successful graph run (no errors, status = "done").
   *
   * @param itinerary  The completed Itinerary to index.
   * @param brief      The TravelBrief that produced it (for filtering metadata).
   */
  async saveTemplate(itinerary: Itinerary, brief: TravelBrief): Promise<void> {
    try {
      const queryText = this.briefToQueryString(brief);
      const vector = await this.embeddings.embedQuery(queryText);
      const pointId = this.hashToNumericId(
        `${brief.origin}-${brief.destination}-${brief.departureDate}`,
      );

      const durationDays = this.calculateDays(
        brief.departureDate,
        brief.returnDate,
      );

      const payload: TemplatePayload = {
        origin: brief.origin,
        destination: brief.destination,
        durationDays,
        budgetMax: brief.budgetMax,
        currency: brief.currency,
        travellers: brief.travellers,
        itinerary,
        savedAt: new Date().toISOString(),
      };

      await this.qdrant.upsert(this.COLLECTION, [
        { id: pointId, vector, payload },
      ]);

      this.logger.log(
        `Itinerary template saved for ${brief.origin} → ${brief.destination} (${durationDays} days).`,
      );
    } catch (err) {
      // Non-fatal — template saving is best-effort
      this.logger.warn(
        "Failed to save itinerary template to Qdrant.",
        (err as any).message,
      );
    }
  }

  /**
   * Builds a compact text representation of a TravelBrief suitable for embedding.
   * Order and wording are kept stable to maximise cosine similarity across similar briefs.
   */
  private briefToQueryString(brief: TravelBrief): string {
    const duration = this.calculateDays(brief.departureDate, brief.returnDate);
    return [
      `${brief.origin} to ${brief.destination}`,
      `${duration} days`,
      `${brief.travellers} travellers`,
      `budget ${brief.budgetMax} ${brief.currency}`,
      brief.interests.join(" "),
      brief.accommodationPrefs.join(" "),
    ]
      .filter(Boolean)
      .join(", ");
  }

  /**
   * Patches a template itinerary with new departure/return dates.
   * Shifts all flight times, hotel check-in/out, and activity dates
   * by the same offset as the date difference.
   */
  private patchTemplateDates(
    template: Itinerary,
    newDepartureDate: string,
    newReturnDate: string | undefined,
    brief: TravelBrief,
  ): Itinerary {
    const oldDeparture = new Date(
      template.brief?.departureDate ?? newDepartureDate,
    );
    const newDeparture = new Date(newDepartureDate);
    const offsetMs = newDeparture.getTime() - oldDeparture.getTime();

    const shiftDate = (iso: string | undefined): string => {
      if (!iso) return iso ?? "";
      try {
        return new Date(new Date(iso).getTime() + offsetMs).toISOString();
      } catch {
        return iso;
      }
    };

    const shiftDateOnly = (date: string | undefined): string => {
      if (!date) return date ?? "";
      try {
        const d = new Date(new Date(date).getTime() + offsetMs);
        return d.toISOString().split("T")[0];
      } catch {
        return date;
      }
    };

    const patchedItinerary: Itinerary = {
      ...template,
      brief,
      outboundFlight: template.outboundFlight
        ? {
            ...template.outboundFlight,
            departTime: shiftDate(template.outboundFlight.departTime),
            arriveTime: shiftDate(template.outboundFlight.arriveTime),
          }
        : undefined,
      returnFlight: template.returnFlight
        ? {
            ...template.returnFlight,
            departTime: shiftDate(template.returnFlight.departTime),
            arriveTime: shiftDate(template.returnFlight.arriveTime),
          }
        : undefined,
      hotel: template.hotel
        ? {
            ...template.hotel,
            checkIn: shiftDateOnly(template.hotel.checkIn),
            checkOut: shiftDateOnly(template.hotel.checkOut),
          }
        : undefined,
      activities: (template.activities ?? []).map((act) => ({
        ...act,
        date: shiftDateOnly(act.date),
        startTime: shiftDate(act.startTime),
        endTime: shiftDate(act.endTime),
      })),
      days: (template.days ?? []).map((day) => ({
        ...day,
        date: shiftDateOnly(day.date),
      })),
    };

    return patchedItinerary;
  }

  private calculateDays(departure: string, returnDate?: string): number {
    if (!returnDate) return 1;
    try {
      const d1 = new Date(departure);
      const d2 = new Date(returnDate);
      return Math.max(
        1,
        Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)),
      );
    } catch {
      return 1;
    }
  }

  private hashToNumericId(text: string): number {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) + hash + text.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 2_147_483_647;
  }
}

// ── Private payload type ──────────────────────────────────────────────────────

interface TemplatePayload {
  origin: string;
  destination: string;
  durationDays: number;
  budgetMax: number;
  currency: string;
  travellers: number;
  itinerary: Itinerary;
  savedAt: string;
}
