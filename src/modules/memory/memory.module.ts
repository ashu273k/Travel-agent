import { Module, Global } from "@nestjs/common";
import { QdrantService } from "./qdrant.service";
import { EmbeddingsService } from "./embeddings.service";
import { SemanticCacheService } from "./semantic-cache.service";
import { ItineraryTemplateService } from "./itinerary-template.service";

@Global()
@Module({
  providers: [
    QdrantService,
    EmbeddingsService,
    SemanticCacheService, // L2 Qdrant semantic query cache
    ItineraryTemplateService, // L3 itinerary template fast-path
  ],
  exports: [
    QdrantService,
    EmbeddingsService,
    SemanticCacheService,
    ItineraryTemplateService,
  ],
})
export class MemoryModule {}
