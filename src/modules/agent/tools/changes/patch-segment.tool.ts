import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import {
  Itinerary,
  Flight,
  Hotel,
  Activity,
} from "../../../../common/types/travel.types";

// ── Input schema ──────────────────────────────────────────────────────────────

export const PatchSegmentInputSchema = z.object({
  itineraryId: z.string().describe("ID of the itinerary to patch"),
  segmentId: z
    .string()
    .describe(
      "ID of the specific flight, hotel, or activity segment to update",
    ),
  segmentType: z
    .enum(["flight", "hotel", "activity"])
    .describe("Type of segment being patched"),
  patch: z
    .record(z.string(), z.unknown())
    .describe(
      "Partial object containing only the fields to change. All other fields remain unchanged.",
    ),
});

export type PatchSegmentInput = z.infer<typeof PatchSegmentInputSchema>;

// ── Output type ───────────────────────────────────────────────────────────────

export interface PatchSegmentOutput {
  /** The ID of the segment that was modified */
  segmentId: string;
  /** The full updated segment after the patch is applied */
  patched: Flight | Hotel | Activity;
  /**
   * Field-level delta: only the changed fields.
   * Format: { fieldName: { old: any, new: any } }
   * This is the ONLY thing that should be sent to the LLM context.
   * The full `patched` segment stays in graph state.
   */
  delta: Record<string, { old: unknown; new: unknown }>;
  /** ISO timestamp of when the patch was applied */
  timestamp: string;
}

// ── Tool implementation ───────────────────────────────────────────────────────

@Injectable()
export class PatchSegmentTool {
  private readonly logger = new Logger(PatchSegmentTool.name);

  readonly name = "patch_segment";
  readonly description =
    "Update a single flight, hotel, or activity segment with a partial patch. Returns a delta-only output (changed fields only) rather than the full itinerary. Use this instead of re-assembling when only one segment needs to change.";
  readonly inputSchema = PatchSegmentInputSchema;

  constructor() {}

  /**
   * Applies a partial patch to a segment within an itinerary.
   *
   * The tool does NOT mutate the itinerary directly — it returns the patched
   * segment and the delta. The calling graph node is responsible for merging
   * the result back into `state.itinerary`.
   *
   * RTK note: only the `delta` is compressed and sent to the LLM context.
   * The full `patched` segment is stored in graph state for rule-based ops.
   */
  async execute(
    input: PatchSegmentInput,
    itinerary: Itinerary,
  ): Promise<PatchSegmentOutput> {
    const { segmentId, segmentType, patch } = input;
    const timestamp = new Date().toISOString();

    this.logger.log(
      `Patching ${segmentType} segment [${segmentId}] in itinerary [${input.itineraryId}]`,
    );

    // ── Locate the target segment ─────────────────────────────────────────────
    const original = this.findSegment(itinerary, segmentId, segmentType);

    if (!original) {
      this.logger.warn(
        `Segment [${segmentId}] of type [${segmentType}] not found in itinerary [${input.itineraryId}]`,
      );
      throw new Error(
        `Segment ${segmentId} (${segmentType}) not found in itinerary ${input.itineraryId}.`,
      );
    }

    // ── Apply the patch ───────────────────────────────────────────────────────
    const patched = { ...original, ...patch } as Flight | Hotel | Activity;

    // ── Build the field-level delta ───────────────────────────────────────────
    const delta: Record<string, { old: unknown; new: unknown }> = {};

    for (const key of Object.keys(patch)) {
      const oldVal = (original as any)[key];
      const newVal = (patch as any)[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        delta[key] = { old: oldVal, new: newVal };
      }
    }

    this.logger.log(
      `Patch applied to [${segmentId}]: ${Object.keys(delta).length} field(s) changed — [${Object.keys(delta).join(", ")}]`,
    );

    return { segmentId, patched, delta, timestamp };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private findSegment(
    itinerary: Itinerary,
    segmentId: string,
    segmentType: "flight" | "hotel" | "activity",
  ): Flight | Hotel | Activity | null {
    if (segmentType === "flight") {
      if (itinerary.outboundFlight?.id === segmentId) {
        return itinerary.outboundFlight;
      }
      if (itinerary.returnFlight?.id === segmentId) {
        return itinerary.returnFlight;
      }
    }

    if (segmentType === "hotel") {
      if (itinerary.hotel?.id === segmentId) {
        return itinerary.hotel;
      }
    }

    if (segmentType === "activity") {
      return itinerary.activities?.find((a) => a.id === segmentId) ?? null;
    }

    return null;
  }
}
