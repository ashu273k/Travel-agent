import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { BookingService } from "../../../search/booking/booking.service";
import { ContextCompressorService } from "../context-compressor.service";

export const SearchHotelsInputSchema = z.object({
  destination: z
    .string()
    .describe("Destination city or area name (e.g. Paris)"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
  guests: z.number().min(1).describe("Number of guests"),
  accommodationType: z
    .enum(["hotel", "hostel", "apartment", "resort", "any"])
    .optional()
    .describe("Preferred accommodation type"),
});

export type SearchHotelsInput = z.infer<typeof SearchHotelsInputSchema>;

@Injectable()
export class SearchHotelsTool {
  private readonly logger = new Logger(SearchHotelsTool.name);

  readonly name = "search_hotels";
  readonly description =
    "Search for available accommodations and hotels at a destination for given check-in and check-out dates. Returns compressed options.";
  readonly inputSchema = SearchHotelsInputSchema;

  constructor(
    private readonly bookingService: BookingService,
    private readonly compressorService: ContextCompressorService,
  ) {}

  async execute(
    input: SearchHotelsInput,
  ): Promise<{ result: string; savings: any }> {
    this.logger.log(`Executing search_hotels: ${JSON.stringify(input)}`);

    // 1. Fetch raw API data (which incorporates Qdrant similarity automatically)
    const rawResult = await this.bookingService.searchHotels({
      destination: input.destination,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: input.guests,
      accommodationType: input.accommodationType,
    });

    // 2. Compress payload before sending back to agent context
    const compression = await this.compressorService.compressToolResult(
      "search_hotels",
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
