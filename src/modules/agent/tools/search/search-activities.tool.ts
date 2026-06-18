import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { ActivitiesService } from "../../../search/activities.service";
import { ContextCompressorService } from "../context-compressor.service";

export const SearchActivitiesInputSchema = z.object({
  destination: z
    .string()
    .describe("Destination city or area name (e.g. Paris)"),
  startDate: z.string().describe("Start date in YYYY-MM-DD format"),
  endDate: z.string().describe("End date in YYYY-MM-DD format"),
  interests: z
    .array(z.string())
    .optional()
    .describe("Interests like food, culture, history, relaxation"),
});

export type SearchActivitiesInput = z.infer<typeof SearchActivitiesInputSchema>;

@Injectable()
export class SearchActivitiesTool {
  private readonly logger = new Logger(SearchActivitiesTool.name);

  readonly name = "search_activities";
  readonly description =
    "Search for available things to do, attractions, and local transport at a destination. Returns compressed suggestions.";
  readonly inputSchema = SearchActivitiesInputSchema;

  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly compressorService: ContextCompressorService,
  ) {}

  async execute(
    input: SearchActivitiesInput,
  ): Promise<{ result: string; savings: any }> {
    this.logger.log(`Executing search_activities: ${JSON.stringify(input)}`);

    // 1. Fetch raw API data
    const rawResult = await this.activitiesService.searchActivities({
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate,
      interests: input.interests,
    });

    // 2. Compress payload before sending back to agent context
    const compression = await this.compressorService.compressToolResult(
      "search_activities",
      rawResult,
    );

    return {
      result: compression.compressed,
      savings: {
        beforeBytes: compression.beforeBytes,
        afterBytes: compression.afterBytes,
        rtkUsed: compression.rtkUsed,
      },
    };
  }
}
