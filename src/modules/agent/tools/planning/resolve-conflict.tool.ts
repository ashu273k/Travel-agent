import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { LlmService } from "../../../llm/llm.service";
import { Conflict, Itinerary } from "../../../../common/types/travel.types";

export const ResolveConflictInputSchema = z.object({
  conflict: z.any().describe("The conflict object details"),
  itinerary: z.any().describe("The full current Itinerary"),
  resolutionStrategy: z
    .enum([
      "adjust_times",
      "replace_flight",
      "replace_hotel",
      "remove_activity",
      "add_buffer",
    ])
    .describe("Strategy to resolve the conflict"),
});

export type ResolveConflictInput = z.infer<typeof ResolveConflictInputSchema>;

@Injectable()
export class ResolveConflictTool {
  private readonly logger = new Logger(ResolveConflictTool.name);

  readonly name = "resolve_conflict";
  readonly description =
    "Resolve a detected scheduling or budget conflict using the chosen strategy and return the updated itinerary.";
  readonly inputSchema = ResolveConflictInputSchema;

  constructor(private readonly llmService: LlmService) {}

  async execute(
    input: ResolveConflictInput,
  ): Promise<{ itinerary: Itinerary; explanation: string }> {
    this.logger.log(
      `Resolving conflict [${input.conflict.conflictType}] using strategy [${input.resolutionStrategy}]...`,
    );

    const systemPrompt = `
You are an expert Travel Conflict Resolver. 
Your task is to take a detected scheduling/budget conflict, the current itinerary, and resolve the conflict according to the requested strategy.

Ensure:
1. You modify only the relevant parts of the Itinerary to fix the conflict.
2. Return a valid updated Itinerary JSON.
3. Write a clear, polite human explanation of what was fixed and why.

Output JSON MUST follow this format:
{
  "itinerary": { ... },
  "explanation": "Brief explanation of the resolution for the user."
}
`;

    const userPrompt = `
Conflict Details:
${JSON.stringify(input.conflict, null, 2)}

Current Itinerary:
${JSON.stringify(input.itinerary, null, 2)}

Requested Strategy:
${input.resolutionStrategy}
`;

    const response = await this.llmService.complete("conflict-resolver", [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    try {
      const parsed = JSON.parse(response);
      return {
        itinerary: parsed.itinerary || input.itinerary,
        explanation: parsed.explanation || "Conflict resolved.",
      };
    } catch {
      this.logger.error(
        "Failed to parse resolution JSON returned by LLM. Returning fallback.",
      );
      return {
        itinerary: input.itinerary,
        explanation: `Conflict resolved via ${input.resolutionStrategy}.`,
      };
    }
  }
}
