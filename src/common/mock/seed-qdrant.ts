/**
 * seed-qdrant.ts — One-shot Qdrant Development Seed Script
 *
 * Seeds the `hotels` and `activities` Qdrant collections with the project's
 * canonical mock data so that local development searches return meaningful results
 * without real API keys.
 *
 * Usage:
 *   npm run seed:qdrant
 *
 * Prerequisites:
 *   - Qdrant running locally on port 6333 (via docker-compose or standalone)
 *   - QDRANT_URL set in .env (defaults to http://localhost:6333)
 */

import * as dotenv from "dotenv";
dotenv.config();

import { QdrantClient } from "@qdrant/js-client-rest";

// Import canonical mock data — the single source of truth
import {
  generateMockFlights,
  generateMockHotels,
  generateMockActivities,
} from "./travel-mock-data";

// ── Configuration ──────────────────────────────────────────────────────────────

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const VECTOR_SIZE = 1536;

const client = new QdrantClient({ url: QDRANT_URL });

// ── Collections to initialise ──────────────────────────────────────────────────

const COLLECTIONS = [
  "hotels",
  "activities",
  "itinerary_templates",
  "semantic_query_cache",
  "traveller_preferences",
];

// ── Deterministic embedding (mirrors EmbeddingsService mock logic) ─────────────

function generateMockVector(text: string): number[] {
  const vector = new Array(VECTOR_SIZE).fill(0);

  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }

  for (let j = 0; j < VECTOR_SIZE; j++) {
    const x = Math.sin(hash + j) * 10000;
    vector[j] = x - Math.floor(x);
  }

  let magnitude = 0;
  for (let k = 0; k < VECTOR_SIZE; k++) {
    magnitude += vector[k] * vector[k];
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude > 0) {
    for (let k = 0; k < VECTOR_SIZE; k++) {
      vector[k] /= magnitude;
    }
  }

  return vector;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hashId(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) + hash + text.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) % 2_147_483_647;
}

async function ensureCollections() {
  console.log("Ensuring Qdrant collections exist...");

  const { collections } = await client.getCollections();
  const existingNames = collections.map((c) => c.name);

  for (const name of COLLECTIONS) {
    if (!existingNames.includes(name)) {
      console.log(`  Creating collection: ${name}`);
      await client.createCollection(name, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      });
    } else {
      console.log(`  Collection already exists: ${name}`);
    }
  }
}

async function seedHotels() {
  console.log("\nSeeding hotels collection...");

  // Use three different destinations for variety
  const destinations = ["Paris, France", "Tokyo, Japan", "New York, USA"];

  const points: Array<{ id: number; vector: number[]; payload: any }> = [];

  for (const destination of destinations) {
    const hotels = generateMockHotels({
      destination,
      checkIn: "2026-08-15",
      checkOut: "2026-08-20",
      guests: 2,
    });

    for (const hotel of hotels) {
      const embeddingText = [
        hotel.name,
        `${hotel.stars} stars`,
        destination,
        (hotel.amenities ?? []).join(" "),
      ].join(", ");

      points.push({
        id: hashId(`hotel-${hotel.id}`),
        vector: generateMockVector(embeddingText),
        payload: {
          hotelId: hotel.id,
          name: hotel.name,
          city: destination,
          starRating: hotel.stars,
          avgPriceINR: hotel.pricePerNight,
          amenities: hotel.amenities ?? [],
          rating: 4.3,
          reviewCount: 1_200,
          checkInTime: hotel.checkInTime,
          lastIndexed: new Date().toISOString(),
        },
      });
    }
  }

  await client.upsert("hotels", { wait: true, points });
  console.log(`  Upserted ${points.length} hotel points.`);
}

async function seedActivities() {
  console.log("\nSeeding activities collection...");

  const destinations = [
    { destination: "Paris, France", interests: ["history", "food", "art"] },
    { destination: "Tokyo, Japan", interests: ["temples", "anime", "food"] },
    {
      destination: "New York, USA",
      interests: ["museums", "food", "shopping"],
    },
  ];

  const points: Array<{ id: number; vector: number[]; payload: any }> = [];

  for (const { destination, interests } of destinations) {
    const activities = generateMockActivities({
      destination,
      startDate: "2026-08-15",
      endDate: "2026-08-20",
      interests,
    });

    for (const activity of activities) {
      const embeddingText = [
        activity.name,
        activity.type,
        destination,
        activity.notes,
      ].join(", ");

      points.push({
        id: hashId(`activity-${activity.id}`),
        vector: generateMockVector(embeddingText),
        payload: {
          activityId: activity.id,
          name: activity.name,
          type: activity.type,
          city: destination,
          durationMins: activity.durationMins,
          priceINR: activity.cost,
          rating: 4.5,
          notes: activity.notes,
          lastIndexed: new Date().toISOString(),
        },
      });
    }
  }

  await client.upsert("activities", { wait: true, points });
  console.log(`  Upserted ${points.length} activity points.`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌍 Qdrant Seed Script — connecting to ${QDRANT_URL}\n`);

  try {
    await client.getCollections(); // Health check
    console.log("✅ Connected to Qdrant\n");
  } catch (err) {
    console.error("❌ Cannot connect to Qdrant:", (err as any).message);
    console.error("   Make sure Qdrant is running: docker-compose up qdrant");
    process.exit(1);
  }

  await ensureCollections();
  await seedHotels();
  await seedActivities();

  console.log("\n✅ Seed complete. Qdrant is ready for local development.\n");

  console.log("Collection summary:");
  const { collections } = await client.getCollections();
  for (const col of collections) {
    console.log(`  ${col.name}`);
  }
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
