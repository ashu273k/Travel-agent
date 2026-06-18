import {
  TravelBrief,
  Flight,
  Hotel,
  Activity,
  Itinerary,
  Conflict,
} from "./travel.types";

export interface ThoughtEntry {
  nodeName: string;
  thought: string;
  timestamp: string;
}

export interface ToolCallEntry {
  tool: string;
  input: unknown;
  output: string; // RTK compressed result
  timestamp: string;
  tokensBeforeRTK?: number;
  tokensAfterRTK?: number;
}

export interface Resolution {
  conflictId: string;
  action:
    | "rebook"
    | "reorder"
    | "remove"
    | "adjust_time"
    | "suggest_alternative"
    | "add_buffer"
    | "replace_hotel"
    | "replace_flight";
  explanation: string;
  updatedSegmentIds: string[];
}

export interface BudgetSummary {
  flightsCost: number;
  hotelsCost: number;
  activitiesCost: number;
  totalCost: number;
  budgetMax: number;
  overrunAmount: number;
  isOverBudget: boolean;
}

export interface ChangeRequest {
  changeType:
    | "flight_delay"
    | "flight_cancellation"
    | "date_change"
    | "hotel_cancellation";
  affectedBookingRef: string;
  newDetails?: Record<string, unknown>;
  timestamp: string;
}

export interface TravelAgentState {
  // Identity
  sessionId: string;
  tripId: string;
  userId: string;

  // Input
  rawBrief: string;

  // Parsed constraints
  parsedBrief: TravelBrief | null;

  // Search options
  flightOptions: Flight[];
  hotelOptions: Hotel[];
  activityOptions: Activity[];
  restaurantOptions: Activity[];

  // Planning
  itinerary: Itinerary | null;
  conflicts: Conflict[];
  resolvedConflicts: Resolution[];
  budgetSummary: BudgetSummary | null;

  // Change management
  changeRequest: ChangeRequest | null;
  affectedSegmentIds: string[];
  revisedItinerary: Itinerary | null;

  // Agent bookkeeping
  currentNode: string;
  thoughtLog: ThoughtEntry[];
  toolCallLog: ToolCallEntry[];
  errors: string[];
  status:
    | "parsing"
    | "searching"
    | "assembling"
    | "resolving"
    | "changing"
    | "done"
    | "error";

  // RTK Context window snapshot
  compressedContext?: string;
}

export interface RTKSavings {
  beforeTokens: number;
  afterTokens: number;
  savedPct: number;
}
