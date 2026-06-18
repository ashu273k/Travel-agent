import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ActivitiesService } from "../../../search/activities/activities.service";
import { ContextCompressorService } from "../context-compressor.service";
import { SearchToolBase } from "./search-tool.base";

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
export class SearchActivitiesTool extends SearchToolBase<
  typeof SearchActivitiesInputSchema
> {
  readonly name = "search_activities";
  readonly description =
    "Search for available things to do, attractions, and local transport at a destination. Returns compressed suggestions.";
  readonly inputSchema = SearchActivitiesInputSchema;

  constructor(
    private readonly activitiesService: ActivitiesService,
    compressorService: ContextCompressorService,
  ) {
    super(compressorService, SearchActivitiesTool.name);
  }

  protected async performSearch(input: SearchActivitiesInput): Promise<any> {
    return this.activitiesService.searchActivities({
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate,
      interests: input.interests,
    });
  }
}
