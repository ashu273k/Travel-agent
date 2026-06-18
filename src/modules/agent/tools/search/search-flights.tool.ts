import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { AmadeusService } from "../../../search/amadeus/amadeus.service";
import { ContextCompressorService } from "../context-compressor.service";
import { SearchToolBase } from "./search-tool.base";

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
export class SearchFlightsTool extends SearchToolBase<
  typeof SearchFlightsInputSchema
> {
  readonly name = "search_flights";
  readonly description =
    "Search for available flight offers between origin and destination on a given date. Returns compressed options only.";
  readonly inputSchema = SearchFlightsInputSchema;

  constructor(
    private readonly amadeusService: AmadeusService,
    compressorService: ContextCompressorService,
  ) {
    super(compressorService, SearchFlightsTool.name);
  }

  protected async performSearch(input: SearchFlightsInput): Promise<any> {
    return this.amadeusService.searchFlights({
      origin: input.origin,
      destination: input.destination,
      date: input.date,
      travellers: input.travellers,
      preferredClass: input.preferredClass,
    });
  }
}
