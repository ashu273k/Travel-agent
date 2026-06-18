import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { AmadeusService } from "../../../search/amadeus/amadeus.service";
import { ContextCompressorService } from "../context-compressor.service";

export const SearchFlightsInputSchema = z.object({
  origin: z.string().describe("Origin airport IATA code (e.g., BOM)"),
  destination: z.string().describe("Destination airport IATA code (e.g., CDG)"),
  date: z.string().describe("Departure date in YYYY-MM-DD format"),
  travellers: z.number().min(1).describe("Number of adult travellers"),
  preferredClass: z
    .enum(["economy", "premium_economy", "business"])
    .optional()
    .describe("Preferred cabin class"),
});

export type SearchFlightsInput = z.infer<typeof SearchFlightsInputSchema>;

@Injectable()
export class SearchFlightsTool {
  private readonly logger = new Logger(SearchFlightsTool.name);

  readonly name = "search_flights";
  readonly description =
    "Search for available flight offers between origin and destination on a given date. Returns compressed options only.";
  readonly inputSchema = SearchFlightsInputSchema;

  constructor(
    private readonly amadeusService: AmadeusService,
    private readonly compressorService: ContextCompressorService,
  ) {}

  async execute(
    input: SearchFlightsInput,
  ): Promise<{ result: string; savings: any }> {
    this.logger.log(`Executing search_flights: ${JSON.stringify(input)}`);

    // 1. Fetch raw API data
    const rawResult = await this.amadeusService.searchFlights({
      origin: input.origin,
      destination: input.destination,
      date: input.date,
      travellers: input.travellers,
      preferredClass: input.preferredClass,
    });

    // 2. Compress payload before sending back to agent context (RTK/LeanCTX pattern)
    const compression = await this.compressorService.compressToolResult(
      "search_flights",
      rawResult,
    );

    return {
      result: compression.compressed,
      savings: {
        beforeBytes: compression.beforeBytes,
        afterBytes: compression.afterBytes,
        rtkUsed: compression.rtkUsed,
      },
    };
  }
}
