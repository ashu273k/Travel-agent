import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { LlmService } from "../../../llm/llm.service";
import {
  TravelBrief,
  Flight,
  Hotel,
  Activity,
} from "../../../../common/types/travel.types";

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
export class AssembleItineraryTool {
  private readonly logger = new Logger(AssembleItineraryTool.name);

  readonly name = "assemble_itinerary";
  readonly description =
    "Assemble selected flight, hotel, and activity options into a structured day-by-day Itinerary.";
  readonly inputSchema = AssembleItineraryInputSchema;

  constructor(private readonly llmService: LlmService) {}

  async execute(input: AssembleItineraryInput): Promise<any> {
    this.logger.log("Executing assemble_itinerary tool via LLM...");

    const systemPrompt = `
You are an expert Travel Itinerary Assembler.
Your task is to review a user's travel brief and selected compressed search options (flights, hotels, and activities), select the best items that fit the budget, and compile a cohesive, structured day-by-day itinerary.

Output MUST be a valid JSON matching the Itinerary schema:
{
  "id": "itinerary-id",
  "brief": { ... },
  "outboundFlight": { ... },
  "returnFlight": { ... },
  "hotel": { ... },
  "activities": [ ... ],
  "days": [
    {
      "date": "YYYY-MM-DD",
      "items": [ ... ]
    }
  ],
  "totalCost": 150000,
  "status": "PLANNING"
}

Ensure:
1. The budget limit in the brief is NOT exceeded.
2. The days array has a DayPlan for each date of the trip, in order.
3. Items are sorted chronologically within each day.
`;

    const userPrompt = `
Travel Brief:
${JSON.stringify(input.brief, null, 2)}

Flight Options:
${JSON.stringify(input.flightOptions, null, 2)}

Hotel Options:
${JSON.stringify(input.hotelOptions, null, 2)}

Activity Options:
${JSON.stringify(input.activityOptions, null, 2)}
`;

    const response = await this.llmService.complete("itinerary-assembler", [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    try {
      return JSON.parse(response);
    } catch {
      this.logger.error(
        "Failed to parse itinerary JSON returned by LLM. Returning raw string.",
      );
      return { rawResult: response };
    }
  }
}
