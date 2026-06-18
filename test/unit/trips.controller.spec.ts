import { describe, it, expect, vi, beforeEach } from "vitest";
import { TripsController } from "../../src/modules/trips/trips.controller";
import { TripStatus } from "@prisma/client";

describe("TripsController", () => {
  let controller: TripsController;

  const mockTripsRepository = {
    createSession: vi.fn(),
    getSession: vi.fn(),
    createTrip: vi.fn(),
    getTrip: vi.fn(),
    updateTrip: vi.fn(),
    updateSession: vi.fn(),
  };

  const mockTravelGraph = {
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TripsController(
      mockTripsRepository as any,
      mockTravelGraph as any,
    );
  });

  it("should submit a brief and start graph execution asynchronously", async () => {
    const trip = {
      id: "trip-1",
      userId: "user-1",
      status: TripStatus.PLANNING,
    };
    const session = { id: "sess-1", tripId: "trip-1" };
    mockTripsRepository.createTrip.mockResolvedValue(trip);
    mockTripsRepository.createSession.mockResolvedValue(session);
    mockTravelGraph.execute.mockResolvedValue({
      errors: [],
      parsedBrief: {},
      itinerary: { totalCost: 100000 },
      conflicts: [],
      thoughtLog: [],
      toolCallLog: [],
    });

    const res = await controller.submitBrief({
      userId: "user-1",
      brief: "trip brief",
    });
    expect(res).toEqual({ sessionId: "sess-1", tripId: "trip-1" });
    expect(mockTripsRepository.createTrip).toHaveBeenCalledWith(
      "user-1",
      "trip brief",
    );
    expect(mockTripsRepository.createSession).toHaveBeenCalledWith("trip-1");

    await new Promise((r) => setTimeout(r, 10));
    expect(mockTravelGraph.execute).toHaveBeenCalled();
  });

  it("should request a change and run graph asynchronously", async () => {
    const trip = {
      id: "trip-1",
      userId: "user-1",
      status: TripStatus.PLANNING,
      itinerary: {},
      parsedBrief: {},
    };
    const session = { id: "sess-1", tripId: "trip-1" };
    mockTripsRepository.getSession.mockResolvedValue(session);
    mockTripsRepository.getTrip.mockResolvedValue(trip);
    mockTravelGraph.execute.mockResolvedValue({
      errors: [],
      itinerary: {},
      conflicts: [],
      thoughtLog: [],
      toolCallLog: [],
    });

    const res = await controller.requestChange({
      sessionId: "sess-1",
      changeRequest: {
        changeType: "flight_delay",
        affectedBookingRef: "ref-1",
      },
    });
    expect(res).toEqual({ status: "processing", sessionId: "sess-1" });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockTravelGraph.execute).toHaveBeenCalled();
  });
});
