import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ActivitySearchRequest } from "../../common/types/search.types";
import { QdrantService } from "../memory/qdrant.service";
import { EmbeddingsService } from "../memory/embeddings.service";
import { RedisService } from "../cache/redis.service";
import {
  generateMockActivities,
  MockActivitySearchRequest,
} from "../../common/mock/travel-mock-data";

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);
  private googleKey?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly qdrantService: QdrantService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly redisService: RedisService,
  ) {
    this.googleKey = this.configService.get<string>("GOOGLE_PLACES_API_KEY");
  }

  /**
   * Search for activities at the destination using Qdrant vector retrieval or mock Places fallback
   */
  async searchActivities(req: ActivitySearchRequest): Promise<any[]> {
    const cacheKey = `activities:${req.destination}:${req.startDate}:${req.endDate}:${req.interests?.join(",") || "all"}`;
    return this.redisService.getOrSearch(cacheKey, 3600, async () => {
      this.logger.log(`Searching activities in ${req.destination}...`);

      try {
        const queryText = `Fun activities, museums, sights, and restaurants in ${req.destination} related to ${req.interests?.join(", ") || "sightseeing"}`;
        const vector = await this.embeddingsService.embedQuery(queryText);

        const qdrantResults = await this.qdrantService.search(
          "activities",
          vector,
          5,
        );

        if (qdrantResults.length > 0) {
          return qdrantResults.map((qr) => qr.payload);
        }
      } catch (err) {
        this.logger.warn(
          "Qdrant lookup failed during activities search.",
          (err as any).message,
        );
      }

      return generateMockActivities(req as MockActivitySearchRequest);
    });
  }
}
