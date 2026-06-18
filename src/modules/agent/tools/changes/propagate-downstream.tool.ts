import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { Itinerary, Conflict } from "../../../../common/types/travel.types";
import { DetectConflictsTool } from "../planning/detect-conflicts.tool";

export const PropagateDownstreamInputSchema = z.object({
  itinerary: z.any().describe("The active itinerary object"),
  changedSegmentId: z
    .string()
    .describe("The ID of the segment that was changed"),
  affectedSegmentIds: z.array(
    z.string().describe("Directly/indirectly affected segments"),
  ),
});

export type PropagateDownstreamInput = z.infer<
  typeof PropagateDownstreamInputSchema
>;

@Injectable()
export class PropagateDownstreamTool {
  private readonly logger = new Logger(PropagateDownstreamTool.name);

  readonly name = "propagate_downstream";
  readonly description =
    "Identifies downstream impacts of changed segments and returns new conflicts requiring resolution.";
  readonly inputSchema = PropagateDownstreamInputSchema;

  constructor(private readonly detectConflictsTool: DetectConflictsTool) {}

  async execute(input: {
    itinerary: Itinerary;
    changedSegmentId: string;
    affectedSegmentIds: string[];
  }): Promise<{ conflicts: Conflict[] }> {
    const { itinerary, changedSegmentId, affectedSegmentIds } = input;
    this.logger.log(
      `Propagating downstream changes from segment ${changedSegmentId}`,
    );

    const detection = await this.detectConflictsTool.execute({ itinerary });

    const relevantConflicts = detection.conflicts.filter((c) =>
      c.affectedItems.some(
        (item) =>
          item === changedSegmentId || affectedSegmentIds.includes(item),
      ),
    );

    return { conflicts: relevantConflicts };
  }
}
