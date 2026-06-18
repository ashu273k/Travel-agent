import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { LlmService } from "../../../llm/llm.service";
import { Itinerary } from "../../../../common/types/travel.types";
import { LlmToolBase } from "../llm-tool.base";

export const AssembleItineraryInputSchema = z.object({
  brief: z.any().describe("The travel brief constraints"),
  flightOptions: z
    .array(z.any())
    .describe("The compressed flight options available"),
  hotelOptions: z
    .array(z.any())
    .describe("The compressed hotel options available"),
  activityOptions: z
    .array(z.any())
    .describe("The compressed activity options available"),
});

export type AssembleItineraryInput = z.infer<
  typeof AssembleItineraryInputSchema
>;

@Injectable()
export class AssembleItineraryTool extends LlmToolBase<
  typeof AssembleItineraryInputSchema,
  Itinerary
> {
  readonly name = "assemble_itinerary";
  readonly description =
    "Assemble selected flight, hotel, and activity options into a structured day-by-day Itinerary.";
  readonly inputSchema = AssembleItineraryInputSchema;

  constructor(llmService: LlmService) {
    super(llmService, AssembleItineraryTool.name);
  }

  protected getSystemPrompt(): string {
    return `You are an expert Travel Itinerary Assembler.
Select the best items that fit the budget and compile a structured day-by-day itinerary.
Output MUST be a valid Itinerary JSON.
Ensure:
1. Budget limit is NOT exceeded.
2. Days are in order.
3. Items are chronological.`;
  }

  protected getUserPrompt(input: AssembleItineraryInput): string {
    return `Brief: ${JSON.stringify(input.brief)}\nFlights: ${JSON.stringify(input.flightOptions)}\nHotels: ${JSON.stringify(input.hotelOptions)}\nActivities: ${JSON.stringify(input.activityOptions)}`;
  }

  protected getFallbackResponse(response: string): Itinerary {
    return JSON.parse(response);
  }
}
