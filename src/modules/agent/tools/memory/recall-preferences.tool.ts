import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { QdrantService } from "../../../memory/qdrant.service";
import { EmbeddingsService } from "../../../memory/embeddings.service";

export const RecallPreferencesInputSchema = z.object({
  userId: z.string().describe("The user ID"),
  query: z.string().describe("Search query for preferences"),
  limit: z.number().optional().default(5),
});

export type RecallPreferencesInput = z.infer<
  typeof RecallPreferencesInputSchema
>;

@Injectable()
export class RecallPreferencesTool {
  private readonly logger = new Logger(RecallPreferencesTool.name);

  readonly name = "recall_preferences";
  readonly description =
    "Query Qdrant semantic memory to recall user preferences matching query.";
  readonly inputSchema = RecallPreferencesInputSchema;

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async execute(
    input: RecallPreferencesInput,
  ): Promise<{ preferences: string[] }> {
    this.logger.log(
      `Recalling preferences for user ${input.userId} matching query: ${input.query}`,
    );
    const queryVector = await this.embeddingsService.embedQuery(input.query);
    const searchResults = await this.qdrantService.search(
      "traveller_preferences",
      queryVector,
      input.limit || 5,
    );

    // Filter by userId if payload is returned
    const preferences = searchResults
      .filter((r) => r.payload?.userId === input.userId)
      .map((r) => r.payload?.preference)
      .filter(Boolean);

    return { preferences };
  }
}
