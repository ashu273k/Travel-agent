import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QdrantClient } from "@qdrant/js-client-rest";

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private client: QdrantClient | null = null;
  private useFallback = false;
  private inMemoryDb = new Map<
    string,
    Array<{ id: string | number; vector: number[]; payload: any }>
  >();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>(
      "QDRANT_URL",
      "http://localhost:6333",
    );
    try {
      this.client = new QdrantClient({ url });
      await Promise.race([
        this.client.getCollections(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 3000),
        ),
      ]);
      this.useFallback = false;
      await this.initializeCollections();
    } catch (error) {
      this.logger.error("Qdrant failed. Using fallback.", error);
      this.useFallback = true;
    }
  }

  async initializeCollections() {
    if (this.useFallback || !this.client) return;
    const collections = [
      "traveller_preferences",
      "itinerary_history",
      "search_result_cache",
      "hotels",
      "activities",
      "itinerary_templates",
      "semantic_query_cache",
    ];
    try {
      const { collections: existing } = await this.client.getCollections();
      const names = existing.map((c) => c.name);
      for (const name of collections) {
        if (!names.includes(name)) {
          await this.client.createCollection(name, {
            vectors: { size: 1536, distance: "Cosine" },
          });
        }
      }
    } catch (error) {
      this.useFallback = true;
    }
  }

  async upsert(
    collectionName: string,
    points: Array<{ id: string | number; vector: number[]; payload: any }>,
  ): Promise<void> {
    if (!this.useFallback && this.client) {
      try {
        await this.client.upsert(collectionName, { wait: true, points });
        return;
      } catch {
        this.useFallback = true;
      }
    }
    const store = this.inMemoryDb.get(collectionName) || [];
    for (const point of points) {
      const idx = store.findIndex((p) => p.id === point.id);
      if (idx >= 0) store[idx] = point;
      else store.push(point);
    }
    this.inMemoryDb.set(collectionName, store);
  }

  async search(
    collectionName: string,
    queryVector: number[],
    limit = 5,
  ): Promise<Array<{ id: string | number; score: number; payload: any }>> {
    if (!this.useFallback && this.client) {
      try {
        const results = await this.client.search(collectionName, {
          vector: queryVector,
          limit,
          with_payload: true,
        });
        return results.map((r) => ({
          id: r.id,
          score: r.score,
          payload: r.payload,
        }));
      } catch {
        this.useFallback = true;
      }
    }
    const store = this.inMemoryDb.get(collectionName) || [];
    const scored = store.map((p) => ({
      id: p.id,
      score: this.cosineSimilarity(queryVector, p.vector),
      payload: p.payload,
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    let dot = 0,
      nA = 0,
      nB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      nA += vecA[i] * vecA[i];
      nB += vecB[i] * vecB[i];
    }
    return nA === 0 || nB === 0 ? 0 : dot / (Math.sqrt(nA) * Math.sqrt(nB));
  }
}
