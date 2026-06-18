/**
 * travel-mock-data.ts
 *
 * Central repository for all mock/seed data used when real external APIs
 * (Amadeus, Booking.com, Google Places) are unavailable or unconfigured.
 *
 * Rules:
 *  - All mock generators are pure functions — no side-effects, no logging.
 *  - They must return data that exactly mirrors the shape of the real API
 *    response so the compressors work identically in both code paths.
 *  - Planted conflicts are intentional and documented inline.
 */

// ---------------------------------------------------------------------------
// Types (matching real API shapes, NOT the compressed domain types)
// ---------------------------------------------------------------------------

export interface MockFlightSearchRequest {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  travellers: number;
  preferredClass?: string;
}

export interface MockHotelSearchRequest {
  destination: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  guests: number;
  accommodationType?: string;
}

export interface MockActivitySearchRequest {
  destination: string;
  startDate: string;
  endDate: string;
  interests?: string[];
}

// ---------------------------------------------------------------------------
// Flights — Amadeus v2/shopping/flight-offers response shape
// ---------------------------------------------------------------------------

/**
 * Returns mock Amadeus-format flight offers for the given search request.
 *
 * Planted conflict: Flight option #1 is a direct flight arriving at 17:45.
 * The mock hotel's default check-in time is 15:00, creating a
 * CHECK_IN_BEFORE_LANDING conflict for demo and eval purposes.
 */
export function generateMockFlights(req: MockFlightSearchRequest): any {
  const carrierCode = req.origin.startsWith("B") ? "AI" : "LH";

  return {
    data: [
      {
        id: "flight-option-1",
        validatingAirlineCodes: [carrierCode],
        itineraries: [
          {
            duration: "PT9H15M",
            segments: [
              {
                number: "131",
                departure: {
                  iataCode: req.origin,
                  at: `${req.date}T08:30:00`,
                },
                arrival: {
                  iataCode: req.destination,
                  // ⚠️ PLANTED CONFLICT: arrives 17:45 → after hotel check-in opens at 15:00
                  // but on same day — used to trigger CHECK_IN_BEFORE_LANDING rule
                  at: `${req.date}T17:45:00`,
                },
              },
            ],
          },
        ],
        price: { grandTotal: "600.00" },
        travelerPricings: [
          {
            fareDetailsBySegment: [
              { cabin: (req.preferredClass ?? "economy").toUpperCase() },
            ],
          },
        ],
      },
      {
        id: "flight-option-2",
        validatingAirlineCodes: [carrierCode],
        itineraries: [
          {
            duration: "PT11H45M",
            segments: [
              {
                number: "135",
                departure: {
                  iataCode: req.origin,
                  at: `${req.date}T11:00:00`,
                },
                arrival: { iataCode: "DXB", at: `${req.date}T13:30:00` },
              },
              {
                number: "136",
                departure: { iataCode: "DXB", at: `${req.date}T15:00:00` },
                arrival: {
                  iataCode: req.destination,
                  at: `${req.date}T22:45:00`,
                },
              },
            ],
          },
        ],
        price: { grandTotal: "550.00" },
        travelerPricings: [
          {
            fareDetailsBySegment: [
              { cabin: (req.preferredClass ?? "economy").toUpperCase() },
            ],
          },
        ],
      },
      {
        id: "flight-option-3",
        validatingAirlineCodes: ["EK"],
        itineraries: [
          {
            duration: "PT10H30M",
            segments: [
              {
                number: "501",
                departure: {
                  iataCode: req.origin,
                  at: `${req.date}T04:15:00`,
                },
                arrival: { iataCode: "DXB", at: `${req.date}T06:30:00` },
              },
              {
                number: "73",
                departure: { iataCode: "DXB", at: `${req.date}T08:20:00` },
                arrival: {
                  iataCode: req.destination,
                  at: `${req.date}T14:45:00`,
                },
              },
            ],
          },
        ],
        price: { grandTotal: "720.00" },
        travelerPricings: [
          {
            fareDetailsBySegment: [
              { cabin: (req.preferredClass ?? "economy").toUpperCase() },
            ],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Hotels — internal shape used by BookingService before compression
// ---------------------------------------------------------------------------

/**
 * Returns mock hotel listings for the given search request.
 *
 * Price is calculated as pricePerNight × nights to keep totals realistic.
 * The first hotel has checkInTime of "15:00" which, combined with the
 * planted flight landing at 17:45, creates a CHECK_IN_BEFORE_LANDING conflict.
 */
export function generateMockHotels(req: MockHotelSearchRequest): any[] {
  const nights = calculateNights(req.checkIn, req.checkOut);

  return [
    {
      id: "h1",
      name: "Hotel Eiffel Seine",
      stars: 4,
      address: "3 Avenue de Suffren, 75007 Paris, France",
      coordinates: { lat: 48.8558, lng: 2.2926 },
      checkIn: req.checkIn,
      checkOut: req.checkOut,
      // ⚠️ PLANTED CONFLICT ENABLER: check-in opens at 15:00 but
      // flight option-1 lands at 17:45 (2h45m after check-in open)
      checkInTime: "15:00",
      checkOutTime: "11:00",
      pricePerNight: 18_000,
      totalPrice: 18_000 * nights,
      amenities: ["wifi", "bar", "air_conditioning", "city-center"],
      bookingRef: "ref-hotel-eiffel-seine",
    },
    {
      id: "h2",
      name: "Pullman Paris Tour Eiffel",
      stars: 4,
      address: "18 Avenue de Suffren, 75015 Paris, France",
      coordinates: { lat: 48.854, lng: 2.2915 },
      checkIn: req.checkIn,
      checkOut: req.checkOut,
      checkInTime: "14:00",
      checkOutTime: "12:00",
      pricePerNight: 24_000,
      totalPrice: 24_000 * nights,
      amenities: ["wifi", "gym", "restaurant", "bar", "pool", "city-center"],
      bookingRef: "ref-pullman-eiffel",
    },
    {
      id: "h3",
      name: "Generator Paris",
      stars: 2,
      address: "9-11 Place du Colonel Fabien, 75010 Paris, France",
      coordinates: { lat: 48.8786, lng: 2.3708 },
      checkIn: req.checkIn,
      checkOut: req.checkOut,
      checkInTime: "14:00",
      checkOutTime: "11:00",
      pricePerNight: 4_500,
      totalPrice: 4_500 * nights,
      amenities: ["wifi", "rooftop", "bar", "laundry"],
      bookingRef: "ref-generator-paris",
    },
  ];
}

// ---------------------------------------------------------------------------
// Activities — internal shape used by ActivitiesService before compression
// ---------------------------------------------------------------------------

/**
 * Returns mock activity listings for the given destination.
 * Activities intentionally do not overlap in time so the base set is clean.
 * The conflict-detection eval suite plants its own overlapping activities.
 */
export function generateMockActivities(req: MockActivitySearchRequest): any[] {
  const baseDate = req.startDate;

  return [
    {
      id: "a1",
      name: "Louvre Museum Guided Tour",
      type: "excursion",
      date: baseDate,
      startTime: `${baseDate}T10:00:00`,
      endTime: `${baseDate}T13:00:00`,
      durationMins: 180,
      cost: 5_500,
      location: "Louvre Museum, Rue de Rivoli, 75001 Paris, France",
      bookingRequired: true,
      notes: "Skip-the-line access. Tour starts at 10:00 AM.",
    },
    {
      id: "a2",
      name: "Paris Food & Wine Tasting Tour",
      type: "restaurant",
      date: baseDate,
      startTime: `${baseDate}T18:00:00`,
      endTime: `${baseDate}T21:00:00`,
      durationMins: 180,
      cost: 9_500,
      location: "Le Marais, 75004 Paris, France",
      bookingRequired: true,
      notes:
        "Includes 6 food stops and wine pairing. Wear comfortable walking shoes.",
    },
    {
      id: "a3",
      name: "Seine River Evening Cruise",
      type: "attraction",
      date: baseDate,
      startTime: `${baseDate}T21:30:00`,
      endTime: `${baseDate}T23:00:00`,
      durationMins: 90,
      cost: 2_200,
      location:
        "Bateaux Parisiens, Port de la Bourdonnais, 75007 Paris, France",
      bookingRequired: false,
      notes: "Audio guide included. Cruises depart every 30 minutes.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function calculateNights(checkIn: string, checkOut: string): number {
  try {
    const d1 = new Date(checkIn);
    const d2 = new Date(checkOut);
    const diffMs = Math.abs(d2.getTime() - d1.getTime());
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) || 1;
  } catch {
    return 1;
  }
}
