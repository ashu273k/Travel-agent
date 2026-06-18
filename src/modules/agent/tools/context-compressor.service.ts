import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

@Injectable()
export class ContextCompressorService {
  private readonly logger = new Logger(ContextCompressorService.name);
  private rtkBinPath: string;
  private rtkEnabled: boolean;
  private maxOutputBytes: number;
  private tmpDir: string;

  constructor(private readonly configService: ConfigService) {
    this.rtkBinPath = this.configService.get<string>(
      "RTK_BIN_PATH",
      "/usr/local/bin/rtk",
    );
    this.rtkEnabled = this.configService.get<boolean>("RTK_ENABLED", true);
    this.maxOutputBytes = this.configService.get<number>(
      "RTK_MAX_OUTPUT_BYTES",
      51200,
    );
    this.tmpDir = os.tmpdir();
  }

  async compressToolResult(
    toolName: string,
    rawResult: any,
  ): Promise<{
    compressed: string;
    beforeBytes: number;
    afterBytes: number;
    rtkUsed: boolean;
  }> {
    const rawJson = JSON.stringify(rawResult, null, 2);
    const beforeBytes = Buffer.byteLength(rawJson, "utf8");

    if (this.rtkEnabled) {
      const rtkResult = await this.tryRtkCompression(toolName, rawJson);
      if (rtkResult !== null) {
        const afterBytes = Buffer.byteLength(rtkResult, "utf8");
        return {
          compressed: rtkResult,
          beforeBytes,
          afterBytes,
          rtkUsed: true,
        };
      }
    }

    this.logger.log(
      `Using built-in TypeScript compressor fallback for tool: ${toolName}`,
    );
    let compressedJson = "";

    try {
      if (toolName === "search_flights") {
        compressedJson = JSON.stringify(
          this.compressFlightResponse(rawResult),
          null,
          2,
        );
      } else if (toolName === "search_hotels") {
        compressedJson = JSON.stringify(
          this.compressHotelResponse(rawResult),
          null,
          2,
        );
      } else if (
        toolName === "search_activities" ||
        toolName === "search_restaurants"
      ) {
        compressedJson = JSON.stringify(
          this.compressActivityResponse(rawResult),
          null,
          2,
        );
      } else if (
        toolName === "assemble_itinerary" ||
        toolName === "resolve_conflict"
      ) {
        compressedJson = JSON.stringify(
          this.compressItineraryForContext(rawResult),
          null,
          2,
        );
      } else if (toolName === "change_manager_delta") {
        compressedJson = JSON.stringify(
          this.compressConflictResolution(rawResult),
          null,
          2,
        );
      } else {
        compressedJson = JSON.stringify(
          this.cleanGenericObject(rawResult),
          null,
          2,
        );
      }
    } catch (err) {
      this.logger.error(
        `Fallback TS compressor failed for ${toolName}. Returning cleaned generic JSON.`,
        err,
      );
      compressedJson = JSON.stringify(
        this.cleanGenericObject(rawResult),
        null,
        2,
      );
    }

    if (Buffer.byteLength(compressedJson, "utf8") > this.maxOutputBytes) {
      this.logger.warn(
        `Compressed output size exceeds cap. Truncating to ${this.maxOutputBytes} bytes.`,
      );
      compressedJson =
        compressedJson.substring(0, this.maxOutputBytes) + "\n... [TRUNCATED]";
    }

    const afterBytes = Buffer.byteLength(compressedJson, "utf8");
    return {
      compressed: compressedJson,
      beforeBytes,
      afterBytes,
      rtkUsed: false,
    };
  }

  private async tryRtkCompression(
    toolName: string,
    rawJson: string,
  ): Promise<string | null> {
    const tmpFile = path.join(
      this.tmpDir,
      `rtk-${toolName}-${Date.now()}-${Math.random().toString(36).substring(7)}.json`,
    );

    try {
      await fs.writeFile(tmpFile, rawJson, "utf8");
      const { stdout } = await execFileAsync(
        this.rtkBinPath,
        ["cat", tmpFile],
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 5000,
        },
      );
      return stdout;
    } catch (err) {
      this.logger.warn(
        `RTK execution failed or binary not found at ${this.rtkBinPath}. Fallback will be used.`,
      );
      return null;
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  compressFlightResponse(raw: any): any[] {
    const data = Array.isArray(raw) ? raw : raw?.data || [];
    return data.slice(0, 5).map((offer: any) => {
      const firstItinerary = offer.itineraries?.[0];
      const segments = firstItinerary?.segments || [];
      const firstSegment = segments[0];
      const lastSegment = segments[segments.length - 1];

      return {
        id: offer.id,
        airline: offer.validatingAirlineCodes?.[0] || "Unknown",
        flightNo: firstSegment?.number || "N/A",
        depart: `${firstSegment?.departure?.iataCode || ""} ${this.formatTime(firstSegment?.departure?.at)}`,
        arrive: `${lastSegment?.arrival?.iataCode || ""} ${this.formatTime(lastSegment?.arrival?.at)}`,
        durationMins: this.parseDuration(firstItinerary?.duration),
        stops: segments.length - 1,
        priceINR: offer.price?.grandTotal
          ? Math.round(parseFloat(offer.price.grandTotal) * 84)
          : 0,
        class:
          offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin ||
          "ECONOMY",
        bookingToken: offer.id,
      };
    });
  }

  compressHotelResponse(raw: any): any[] {
    const hotels = Array.isArray(raw) ? raw : raw?.data || raw?.hotels || [];
    return hotels.slice(0, 5).map((hotel: any) => ({
      id: hotel.id || hotel.hotelId,
      name: hotel.name,
      stars: hotel.stars || hotel.starRating || 0,
      address: hotel.address || hotel.addressString || "",
      coordinates: hotel.coordinates || {
        lat: hotel.latitude || 0,
        lng: hotel.longitude || 0,
      },
      pricePerNight: hotel.pricePerNight || hotel.avgPriceINR || 0,
      totalPrice: hotel.totalPrice || 0,
      amenities: (hotel.amenities || []).slice(0, 5),
      bookingRef: hotel.bookingRef || hotel.bookingComId || "",
    }));
  }

  compressActivityResponse(raw: any): any[] {
    const activities = Array.isArray(raw)
      ? raw
      : raw?.data || raw?.results || [];
    return activities.slice(0, 8).map((act: any) => ({
      id: act.id || act.place_id || act.activityId,
      name: act.name,
      type: act.type || "attraction",
      cost: act.cost || act.price_level || 0,
      location: act.location || act.formatted_address || "",
      bookingRequired: !!act.bookingRequired,
      notes: act.notes || act.editorial_summary || "",
    }));
  }

  compressItineraryForContext(itinerary: any): any {
    if (!itinerary || typeof itinerary !== "object")
      return { error: "Invalid itinerary" };
    return {
      id: itinerary.id,
      status: itinerary.status,
      totalCost: itinerary.totalCost,
      outboundFlight: itinerary.outboundFlight
        ? {
            id: itinerary.outboundFlight.id,
            airline: itinerary.outboundFlight.airline,
            depart: itinerary.outboundFlight.departTime,
            arrive: itinerary.outboundFlight.arriveTime,
            price: itinerary.outboundFlight.totalPrice,
            status: itinerary.outboundFlight.status,
          }
        : null,
      returnFlight: itinerary.returnFlight
        ? {
            id: itinerary.returnFlight.id,
            airline: itinerary.returnFlight.airline,
            depart: itinerary.returnFlight.departTime,
            arrive: itinerary.returnFlight.arriveTime,
            price: itinerary.returnFlight.totalPrice,
            status: itinerary.returnFlight.status,
          }
        : null,
      hotel: itinerary.hotel
        ? {
            id: itinerary.hotel.id,
            name: itinerary.hotel.name,
            checkIn: itinerary.hotel.checkIn,
            checkOut: itinerary.hotel.checkOut,
            totalPrice: itinerary.hotel.totalPrice,
          }
        : null,
      activityCount: (itinerary.activities ?? []).length,
      dayCount: (itinerary.days ?? []).length,
    };
  }

  compressConflictResolution(delta: any): any {
    if (!delta || typeof delta !== "object") return { error: "Invalid delta" };
    return {
      changeType: delta.changeType,
      affectedCount: (delta.affectedSegmentIds ?? []).length,
      affectedSegmentIds: (delta.affectedSegmentIds ?? []).slice(0, 10),
      newConflictCount: (delta.newConflicts ?? []).length,
      conflictTypes: (delta.newConflicts ?? []).map(
        (c: any) => c.conflictType ?? c.type,
      ),
    };
  }

  private cleanGenericObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj))
      return obj.slice(0, 10).map((item) => this.cleanGenericObject(item));
    if (typeof obj === "object") {
      const cleaned: any = {};
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (
          val !== null &&
          val !== undefined &&
          val !== "" &&
          !(Array.isArray(val) && val.length === 0)
        ) {
          cleaned[key] = this.cleanGenericObject(val);
        }
      }
      return cleaned;
    }
    return obj;
  }

  private formatTime(dateStr?: string): string {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }

  private parseDuration(durStr?: string): number {
    if (!durStr) return 0;
    try {
      const match = durStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      if (!match) return 0;
      const hours = parseInt(match[1] || "0", 10);
      const minutes = parseInt(match[2] || "0", 10);
      return hours * 60 + minutes;
    } catch {
      return 0;
    }
  }
}
