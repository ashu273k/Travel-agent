import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HotelSearchRequest } from "../../../common/types/search.types";
import { QdrantService } from "../../memory/qdrant.service";
import { EmbeddingsService } from "../../memory/embeddings.service";
import { RedisService } from "../../cache/redis.service";
import {
  generateMockHotels,
  MockHotelSearchRequest,
} from "../../../common/mock/travel-mock-data";
import { SearchServiceBase } from "../search-service.base";

@Injectable()
export class BookingService extends SearchServiceBase {
  private apiKey?: string;
  private useMock = false;

  constructor(
    configService: ConfigService,
    redisService: RedisService,
    private readonly qdrantService: QdrantService,
    private readonly embeddingsService: EmbeddingsService,
  ) {
    super(configService, redisService, BookingService.name);
    this.apiKey = this.configService.get<string>("BOOKING_COM_API_KEY");

    if (!this.apiKey || this.apiKey === "..." || this.apiKey === "") {
      this.logger.warn(
        "Booking.com API keys not configured. Operating in mock availability mode.",
      );
      this.useMock = true;
    }
  }

  async searchHotels(req: HotelSearchRequest): Promise<any[]> {
    const cacheKey = `hotels:${req.destination}:${req.checkIn}:${req.checkOut}:${req.guests}:${req.accommodationType || "any"}`;

    return this.getOrSearch(cacheKey, 600, async () => {
      this.logger.log(
        `Searching hotels in ${req.destination} from ${req.checkIn} to ${req.checkOut}...`,
      );

      try {
        const queryText = `A beautiful, comfortable hotel in ${req.destination} with stars rating ${req.accommodationType || "hotel"}`;
        const vector = await this.embeddingsService.embedQuery(queryText);

        const qdrantResults = await this.qdrantService.search(
          "hotels",
          vector,
          5,
        );

        if (qdrantResults.length > 0) {
          this.logger.log(
            `Found ${qdrantResults.length} hotels matching preferences in Qdrant.`,
          );
          return qdrantResults.map((qr) => {
            const hotel = qr.payload;
            const nights = this.calculateNights(req.checkIn, req.checkOut);
            return {
              id: hotel.id,
              name: hotel.name,
              stars: hotel.stars,
              address: hotel.address,
              coordinates: hotel.coordinates,
              pricePerNight: hotel.pricePerNight,
              totalPrice: hotel.pricePerNight * nights,
              amenities: hotel.amenities,
              bookingRef: hotel.bookingRef,
              qdrantScore: qr.score,
            };
          });
        }
      } catch (err) {
        this.logger.warn(
          "Qdrant lookup failed during hotel search. Falling back to default list.",
          (err as any).message,
        );
      }

      return generateMockHotels(req as MockHotelSearchRequest);
    });
  }

  private calculateNights(checkIn: string, checkOut: string): number {
    try {
      const d1 = new Date(checkIn);
      const d2 = new Date(checkOut);
      const diffTime = Math.abs(d2.getTime() - d1.getTime());
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    } catch {
      return 1;
    }
  }
}
