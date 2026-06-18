import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { ITripsRepository } from "./trips.repository.interface";
import { TravelGraphService } from "../agent/graph/travel-graph";
import { TripStatus } from "@prisma/client";

@Controller("api")
export class TripsController {
  constructor(
    @Inject("ITripsRepository")
    private readonly tripsRepository: ITripsRepository,
    private readonly travelGraph: TravelGraphService,
  ) {}

  @Post("sessions/create")
  async createSession(@Body("tripId") tripId: string) {
    return this.tripsRepository.createSession(tripId);
  }

  @Get("sessions/:sessionId")
  async getSession(@Param("sessionId") sessionId: string) {
    const session = await this.tripsRepository.getSession(sessionId);
    if (!session) throw new NotFoundException("Session not found");
    return session;
  }

  @Post("brief/submit")
  async submitBrief(@Body() body: { userId: string; brief: string }) {
    const { userId, brief } = body;
    const trip = await this.tripsRepository.createTrip(userId, brief);
    const session = await this.tripsRepository.createSession(trip.id);

    (async () => {
      try {
        const finalState = await this.travelGraph.execute({
          sessionId: session.id,
          tripId: trip.id,
          userId,
          rawBrief: brief,
        });

        await this.tripsRepository.updateTrip(trip.id, {
          status:
            finalState.errors.length > 0
              ? TripStatus.PLANNING
              : TripStatus.ASSEMBLING,
          parsedBrief: finalState.parsedBrief,
          itinerary: finalState.itinerary,
          conflicts: finalState.conflicts,
        });

        await this.tripsRepository.updateSession(session.id, {
          status: finalState.errors.length > 0 ? "failed" : "completed",
          thoughtLog: finalState.thoughtLog,
          toolCallLog: finalState.toolCallLog,
        });
      } catch (err) {
        await this.tripsRepository.updateSession(session.id, {
          status: "failed",
        });
      }
    })();

    return { sessionId: session.id, tripId: trip.id };
  }

  @Get("brief/parse/:tripId")
  async parseBrief(@Param("tripId") tripId: string) {
    const trip = await this.tripsRepository.getTrip(tripId);
    if (!trip) throw new NotFoundException("Trip not found");
    return { parsedBrief: trip.parsedBrief };
  }

  @Get("itinerary/:tripId")
  async getItinerary(@Param("tripId") tripId: string) {
    const trip = await this.tripsRepository.getTrip(tripId);
    if (!trip) throw new NotFoundException("Trip not found");
    return trip.itinerary;
  }

  @Post("changes/request")
  async requestChange(
    @Body()
    body: {
      sessionId: string;
      changeRequest: {
        changeType:
          | "flight_delay"
          | "flight_cancellation"
          | "hotel_cancellation";
        affectedBookingRef: string;
        newDetails?: { newTime?: string };
      };
    },
  ) {
    const { sessionId, changeRequest } = body;
    const session = await this.tripsRepository.getSession(sessionId);
    if (!session) throw new NotFoundException("Session not found");

    const trip = await this.tripsRepository.getTrip(session.tripId);
    if (!trip) throw new NotFoundException("Trip not found");

    (async () => {
      try {
        const finalState = await this.travelGraph.execute({
          sessionId: session.id,
          tripId: trip.id,
          userId: trip.userId,
          changeRequest: {
            ...changeRequest,
            timestamp: new Date().toISOString(),
          },
          itinerary: trip.itinerary as any,
          parsedBrief: trip.parsedBrief as any,
        });

        await this.tripsRepository.updateTrip(trip.id, {
          status:
            finalState.errors.length > 0 ? trip.status : TripStatus.CHANGED,
          itinerary: finalState.itinerary,
          conflicts: finalState.conflicts,
        });

        await this.tripsRepository.updateSession(session.id, {
          status: finalState.errors.length > 0 ? "failed" : "completed",
          thoughtLog: finalState.thoughtLog,
          toolCallLog: finalState.toolCallLog,
        });
      } catch (err) {
        await this.tripsRepository.updateSession(session.id, {
          status: "failed",
        });
      }
    })();

    return { status: "processing", sessionId };
  }

  @Post("bookings/confirm")
  async confirmBooking(@Body("tripId") tripId: string) {
    const trip = await this.tripsRepository.getTrip(tripId);
    if (!trip) throw new NotFoundException("Trip not found");

    const updatedTrip = await this.tripsRepository.updateTrip(tripId, {
      status: TripStatus.CONFIRMED,
    });

    return { success: true, status: updatedTrip.status };
  }

  @Get("bookings/status/:tripId")
  async getBookingStatus(@Param("tripId") tripId: string) {
    const trip = await this.tripsRepository.getTrip(tripId);
    if (!trip) throw new NotFoundException("Trip not found");
    return { tripId, status: trip.status };
  }
}
