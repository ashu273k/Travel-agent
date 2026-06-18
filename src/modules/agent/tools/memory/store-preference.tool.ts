import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { QdrantService } from "../../../memory/qdrant.service";
import { EmbeddingsService } from "../../../memory/embeddings.service";

export const StorePreferenceInputSchema = z.object({
  userId: z.string().describe("The user ID"),
  preference: z.string().describe("The preference description text"),
});

export type StorePreferenceInput = z.infer<typeof StorePreferenceInputSchema>;

@Injectable()
export class StorePreferenceTool {
  private readonly logger = new Logger(StorePreferenceTool.name);

  readonly name = "store_preference";
  readonly description = "Save user preference to Qdrant semantic memory.";
  readonly inputSchema = StorePreferenceInputSchema;

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async execute(
    input: StorePreferenceInput,
  ): Promise<{ success: boolean; id: string }> {
    this.logger.log(
      `Storing preference for user ${input.userId}: ${input.preference}`,
    );
    const vector = await this.embeddingsService.embedQuery(input.preference);
    const pointId = `${input.userId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    await this.qdrantService.upsert("traveller_preferences", [
      {
        id: pointId,
        vector,
        payload: {
          userId: input.userId,
          preference: input.preference,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    return { success: true, id: pointId };
  }
}
