import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FlightSearchRequest } from "../../../common/types/search.types";
import { RedisService } from "../../cache/redis.service";
import {
  generateMockFlights,
  MockFlightSearchRequest,
} from "../../../common/mock/travel-mock-data";
import { SearchServiceBase } from "../search-service.base";

@Injectable()
export class AmadeusService extends SearchServiceBase {
  private apiKey?: string;
  private apiSecret?: string;
  private useMock = false;

  constructor(configService: ConfigService, redisService: RedisService) {
    super(configService, redisService, AmadeusService.name);
    this.apiKey = this.configService.get<string>("AMADEUS_API_KEY");
    this.apiSecret = this.configService.get<string>("AMADEUS_API_SECRET");

    if (
      !this.apiKey ||
      !this.apiSecret ||
      this.apiKey === "..." ||
      this.apiSecret === "..."
    ) {
      this.logger.warn(
        "Amadeus API keys not configured. Falling back to realistic mock flights data.",
      );
      this.useMock = true;
    }
  }

  async searchFlights(req: FlightSearchRequest): Promise<any> {
    const cacheKey = `flights:${req.origin}:${req.destination}:${req.date}:${req.travellers}:${req.preferredClass || "economy"}`;

    return this.getOrSearch(cacheKey, 300, async () => {
      this.logger.log(
        `Searching flights from ${req.origin} to ${req.destination} for date ${req.date}...`,
      );

      if (this.useMock) {
        return generateMockFlights(req as MockFlightSearchRequest);
      }

      try {
        const accessToken = await this.getAmadeusToken();
        const response = await fetch(
          `https://test.api.amadeus.com/v2/shopping/flight-offers?originLocationCode=${req.origin}&destinationLocationCode=${req.destination}&departureDate=${req.date}&adults=${req.travellers}&max=5`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Amadeus HTTP error: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        this.logger.error(
          "Amadeus flight search failed. Using mock flights fallback.",
          (error as any).message,
        );
        return generateMockFlights(req as MockFlightSearchRequest);
      }
    });
  }

  private async getAmadeusToken(): Promise<string> {
    const response = await fetch(
      "https://test.api.amadeus.com/v1/security/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.apiSecret}`,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to authenticate with Amadeus: ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.access_token;
  }
}
