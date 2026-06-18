import { Injectable, Logger } from "@nestjs/common";
import { QdrantService } from "./qdrant.service";
import { EmbeddingsService } from "./embeddings.service";
import { RedisService } from "../cache/redis.service";

/**
 * SemanticCacheService — L2 Qdrant Semantic Query Cache
 *
 * Cache hierarchy:
 *   L1 (Redis TTL)      — exact key match, TTL 4h (handled by RedisService.getOrSearch)
 *   L2 (Qdrant Cosine)  — THIS service — near-duplicate query hit, cosine ≥ 0.97
 *   L3 (Template)       — handled by ItineraryTemplateService
 *
 * L2 catches semantically-similar queries that are not byte-identical.
 * Example: "Paris 5 nights ₹2L" and "Paris 4 nights ₹2.2L" both hit the same cache
 * if their embeddings are within the configured distance threshold.
 *
 * TTL enforcement: the cached entry stores `ttlExpiresAt` in its payload.
 * On a cache hit, the service checks if the entry has expired before returning it.
 */
@Injectable()
export class SemanticCacheService {
  private readonly logger = new Logger(SemanticCacheService.name);

  /** Cosine similarity threshold above which a result is considered a cache hit */
  private readonly SIMILARITY_THRESHOLD = 0.97;

  /** Qdrant collection name for semantic query cache */
  private readonly COLLECTION = "semantic_query_cache";

  constructor(
    private readonly qdrant: QdrantService,
    private readonly embeddings: EmbeddingsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Look up a cached result for a semantically-similar query.
   *
   * @param queryText  Natural-language or structured query string to look up.
   * @returns          Parsed cached result if a live hit is found; null otherwise.
   */
  async get<T = any>(queryText: string): Promise<T | null> {
    const cacheKey = this.toRedisKey(queryText);

    // L1 fast-path: exact Redis key lookup (sub-millisecond)
    const exactHit = await this.redis.get(cacheKey);
    if (exactHit) {
      this.logger.debug(`L1 exact cache hit for: "${queryText.slice(0, 60)}"`);
      try {
        return JSON.parse(exactHit) as T;
      } catch {
        // Corrupted entry — fall through to L2
      }
    }

    // L2: Qdrant cosine similarity search
    try {
      const vector = await this.embeddings.embedQuery(queryText);
      const hits = await this.qdrant.search(this.COLLECTION, vector, 1);

      if (hits.length > 0 && hits[0].score >= this.SIMILARITY_THRESHOLD) {
        const entry = hits[0].payload as {
          compressedResult: string;
          ttlExpiresAt: number;
        };

        // Honour TTL — discard stale entries
        if (entry.ttlExpiresAt && Date.now() > entry.ttlExpiresAt) {
          this.logger.debug(
            `L2 semantic cache entry expired for: "${queryText.slice(0, 60)}"`,
          );
          return null;
        }

        this.logger.log(
          `L2 semantic cache HIT (score=${hits[0].score.toFixed(4)}) for: "${queryText.slice(0, 60)}"`,
        );
        return JSON.parse(entry.compressedResult) as T;
      }
    } catch (err) {
      this.logger.warn(
        "L2 semantic cache lookup failed — falling through to live search.",
        (err as any).message,
      );
    }

    return null;
  }

  /**
   * Store a query result in both the L1 Redis cache (exact key) and
   * L2 Qdrant semantic cache (embedding-indexed).
   *
   * @param queryText        The original query text to index.
   * @param result           The compressed result to cache.
   * @param ttlHours         Time-to-live in hours (default: 4).
   */
  async set<T = any>(
    queryText: string,
    result: T,
    ttlHours = 4,
  ): Promise<void> {
    const ttlSeconds = ttlHours * 3600;
    const ttlExpiresAt = Date.now() + ttlSeconds * 1000;
    const serialised = JSON.stringify(result);

    // L1: write to Redis for exact-match fast-path
    const cacheKey = this.toRedisKey(queryText);
    await this.redis.setex(cacheKey, ttlSeconds, serialised);

    // L2: embed and upsert into Qdrant
    try {
      const vector = await this.embeddings.embedQuery(queryText);
      const pointId = this.hashToNumericId(queryText);

      await this.qdrant.upsert(this.COLLECTION, [
        {
          id: pointId,
          vector,
          payload: {
            queryText: queryText.slice(0, 500), // Store for debugging
            compressedResult: serialised,
            ttlExpiresAt,
            cachedAt: new Date().toISOString(),
          },
        },
      ]);

      this.logger.log(
        `L2 semantic cache SET for: "${queryText.slice(0, 60)}" (TTL: ${ttlHours}h)`,
      );
    } catch (err) {
      // L2 write failure is non-fatal — L1 was already written
      this.logger.warn(
        "L2 Qdrant semantic cache write failed. L1 Redis cache still active.",
        (err as any).message,
      );
    }
  }

  /**
   * Generates a consistent Redis cache key for a query string.
   * Normalises whitespace before hashing to improve hit rates.
   */
  private toRedisKey(queryText: string): string {
    const normalised = queryText.toLowerCase().replace(/\s+/g, " ").trim();
    return `semantic_cache:${this.simpleHash(normalised)}`;
  }

  /**
   * Generates a deterministic positive integer ID for a string.
   * Used as the Qdrant point ID.
   */
  private hashToNumericId(text: string): number {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) + hash + text.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Ensure positive
    return Math.abs(hash) % 2_147_483_647;
  }

  private simpleHash(text: string): string {
    return this.hashToNumericId(text).toString(36);
  }
}
