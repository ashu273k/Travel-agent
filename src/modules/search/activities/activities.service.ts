import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ActivitySearchRequest } from "../../../common/types/search.types";
import { QdrantService } from "../../memory/qdrant.service";
import { EmbeddingsService } from "../../memory/embeddings.service";
import { RedisService } from "../../cache/redis.service";
import {
  generateMockActivities,
  MockActivitySearchRequest,
} from "../../../common/mock/travel-mock-data";
import { SearchServiceBase } from "../search-service.base";

@Injectable()
export class ActivitiesService extends SearchServiceBase {
  private googleKey?: string;

  constructor(
    configService: ConfigService,
    redisService: RedisService,
    private readonly qdrantService: QdrantService,
    private readonly embeddingsService: EmbeddingsService,
  ) {
    super(configService, redisService, ActivitiesService.name);
    this.googleKey = this.configService.get<string>("GOOGLE_PLACES_API_KEY");
  }

  async searchActivities(req: ActivitySearchRequest): Promise<any[]> {
    const cacheKey = `activities:${req.destination}:${req.startDate}:${req.endDate}:${req.interests?.join(",") || "all"}`;

    return this.getOrSearch(cacheKey, 3600, async () => {
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
