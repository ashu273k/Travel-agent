import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import {
  Itinerary,
  Flight,
  Hotel,
  Activity,
} from "../../../../common/types/travel.types";
import { ItineraryUtils } from "../../../../common/utils/itinerary.utils";

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
    .describe("Partial object containing only the fields to change."),
});

export type PatchSegmentInput = z.infer<typeof PatchSegmentInputSchema>;

export interface PatchSegmentOutput {
  segmentId: string;
  patched: Flight | Hotel | Activity;
  delta: Record<string, { old: unknown; new: unknown }>;
  timestamp: string;
}

@Injectable()
export class PatchSegmentTool {
  private readonly logger = new Logger(PatchSegmentTool.name);

  readonly name = "patch_segment";
  readonly description =
    "Update a single flight, hotel, or activity segment with a partial patch. Returns a delta-only output.";
  readonly inputSchema = PatchSegmentInputSchema;

  async execute(
    input: PatchSegmentInput,
    itinerary: Itinerary,
  ): Promise<PatchSegmentOutput> {
    const { segmentId, segmentType, patch } = input;
    const timestamp = new Date().toISOString();

    this.logger.log(
      `Patching ${segmentType} segment [${segmentId}] in itinerary [${input.itineraryId}]`,
    );

    const original = ItineraryUtils.findSegment(
      itinerary,
      segmentId,
      segmentType,
    );

    if (!original) {
      this.logger.warn(
        `Segment [${segmentId}] of type [${segmentType}] not found in itinerary [${input.itineraryId}]`,
      );
      throw new Error(
        `Segment ${segmentId} (${segmentType}) not found in itinerary ${input.itineraryId}.`,
      );
    }

    const patched = { ...original, ...patch } as Flight | Hotel | Activity;

    const delta: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(patch)) {
      const oldVal = (original as any)[key];
      const newVal = (patch as any)[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        delta[key] = { old: oldVal, new: newVal };
      }
    }

    this.logger.log(
      `Patch applied to [${segmentId}]: ${Object.keys(delta).length} field(s) changed`,
    );

    return { segmentId, patched, delta, timestamp };
  }
}
