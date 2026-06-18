import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { BookingService } from "../../../search/booking/booking.service";
import { ContextCompressorService } from "../context-compressor.service";
import { SearchToolBase } from "./search-tool.base";

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
export class SearchHotelsTool extends SearchToolBase<
  typeof SearchHotelsInputSchema
> {
  readonly name = "search_hotels";
  readonly description =
    "Search for available accommodations and hotels at a destination for given check-in and check-out dates. Returns compressed options.";
  readonly inputSchema = SearchHotelsInputSchema;

  constructor(
    private readonly bookingService: BookingService,
    compressorService: ContextCompressorService,
  ) {
    super(compressorService, SearchHotelsTool.name);
  }

  protected async performSearch(input: SearchHotelsInput): Promise<any> {
    return this.bookingService.searchHotels({
      destination: input.destination,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: input.guests,
      accommodationType: input.accommodationType,
    });
  }
}
