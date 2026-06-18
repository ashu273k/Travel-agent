import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { LlmService } from "../../../llm/llm.service";
import { Itinerary } from "../../../../common/types/travel.types";
import { LlmToolBase } from "../llm-tool.base";

export const ResolveConflictInputSchema = z.object({
  conflict: z.any().describe("The conflict object details"),
  itinerary: z.any().describe("The full current Itinerary"),
  resolutionStrategy: z.enum([
    "adjust_times",
    "replace_flight",
    "replace_hotel",
    "remove_activity",
    "add_buffer",
  ]),
});

export type ResolveConflictInput = z.infer<typeof ResolveConflictInputSchema>;

export interface ResolutionResult {
  itinerary: Itinerary;
  explanation: string;
}

@Injectable()
export class ResolveConflictTool extends LlmToolBase<
  typeof ResolveConflictInputSchema,
  ResolutionResult
> {
  readonly name = "resolve_conflict";
  readonly description =
    "Resolve a scheduling or budget conflict using the chosen strategy.";
  readonly inputSchema = ResolveConflictInputSchema;

  constructor(llmService: LlmService) {
    super(llmService, ResolveConflictTool.name);
  }

  protected getSystemPrompt(): string {
    return `You are an expert Travel Conflict Resolver.
Modify only relevant parts of the Itinerary to fix the conflict.
Output MUST be a JSON object with 'itinerary' and 'explanation' fields.`;
  }

  protected getUserPrompt(input: ResolveConflictInput): string {
    return `Conflict: ${JSON.stringify(input.conflict)}\nItinerary: ${JSON.stringify(input.itinerary)}\nStrategy: ${input.resolutionStrategy}`;
  }

  protected getFallbackResponse(
    response: string,
    input: ResolveConflictInput,
  ): ResolutionResult {
    return {
      itinerary: input.itinerary,
      explanation: "Conflict resolution failed to parse.",
    };
  }
}
