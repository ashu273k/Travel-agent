import { Annotation } from "@langchain/langgraph";
import {
  TravelBrief,
  Flight,
  Hotel,
  Activity,
  Itinerary,
  Conflict,
} from "../../../common/types/travel.types";
import {
  ThoughtEntry,
  ToolCallEntry,
  Resolution,
  BudgetSummary,
  ChangeRequest,
} from "../../../common/types/agent.types";

// State Annotation definition for LangGraph.js
export const StateAnnotation = Annotation.Root({
  sessionId: Annotation<string>,
  tripId: Annotation<string>,
  userId: Annotation<string>,
  rawBrief: Annotation<string>,

  parsedBrief: Annotation<TravelBrief | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  flightOptions: Annotation<Flight[]>({
    reducer: (left, right) => right || [],
    default: () => [],
  }),

  hotelOptions: Annotation<Hotel[]>({
    reducer: (left, right) => right || [],
    default: () => [],
  }),

  activityOptions: Annotation<Activity[]>({
    reducer: (left, right) => right || [],
    default: () => [],
  }),

  restaurantOptions: Annotation<Activity[]>({
    reducer: (left, right) => right || [],
    default: () => [],
  }),

  itinerary: Annotation<Itinerary | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  conflicts: Annotation<Conflict[]>({
    reducer: (left, right) => right || [],
    default: () => [],
  }),

  resolvedConflicts: Annotation<Resolution[]>({
    reducer: (left, right) => left.concat(right || []),
    default: () => [],
  }),

  budgetSummary: Annotation<BudgetSummary | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  changeRequest: Annotation<ChangeRequest | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  affectedSegmentIds: Annotation<string[]>({
    reducer: (left, right) => right || [],
    default: () => [],
  }),

  revisedItinerary: Annotation<Itinerary | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  currentNode: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "start",
  }),

  thoughtLog: Annotation<ThoughtEntry[]>({
    reducer: (left, right) => left.concat(right || []),
    default: () => [],
  }),

  toolCallLog: Annotation<ToolCallEntry[]>({
    reducer: (left, right) => left.concat(right || []),
    default: () => [],
  }),

  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right || []),
    default: () => [],
  }),

  status: Annotation<
    | "parsing"
    | "searching"
    | "assembling"
    | "resolving"
    | "changing"
    | "done"
    | "error"
  >({
    reducer: (left, right) => right || left,
    default: () => "parsing",
  }),

  compressedContext: Annotation<string | undefined>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => undefined,
  }),
});

export type StateAnnotationType = typeof StateAnnotation.State;
export type StateAnnotationUpdateType = typeof StateAnnotation.Update;
