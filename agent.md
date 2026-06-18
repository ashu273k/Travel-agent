# Agent.md — Agentic Travel Planning System

## Project Overview

Build a multi-tool agentic travel planner that takes a natural-language travel brief and
produces a complete, conflict-free itinerary — then handles post-booking changes automatically.

The system parses intent, runs parallel searches, assembles a coherent day-by-day plan,
detects and resolves scheduling conflicts, and re-plans when disruptions occur.

**Runtime**: NestJS (TypeScript)  
**Agent engine**: LangGraph.js (`@langchain/langgraph`) — compiled StateGraph  
**LLM**: Anthropic Claude via `LlmService` wrapper  
**Compression**: `ContextCompressorService` (RTK-equivalent pattern)  
**Token tracking**: `TokenTrackerService` — per-node breakdown of every LLM call

---

## Architecture

```
src/
├── common/
│   ├── mock/
│   │   └── travel-mock-data.ts   ← Centralised mock data (flights, hotels, activities)
│   └── types/
│       ├── travel.types.ts       ← Domain types: TravelBrief, Flight, Hotel, Itinerary…
│       ├── agent.types.ts        ← Agent state: TravelAgentState, ToolCallEntry…
│       └── search.types.ts       ← FlightSearchRequest, HotelSearchRequest…
│
├── modules/
│   ├── agent/
│   │   ├── agent.module.ts       ← NestJS module wiring all tools + graph
│   │   ├── graph/
│   │   │   ├── travel-graph.ts           ← LangGraph StateMachine (all nodes + routing)
│   │   │   ├── travel-state.ts           ← StateAnnotation — LangGraph state schema
│   │   │   ├── context-manager.service.ts ← Builds stable prefix + dynamic tail for LLM calls
│   │   │   └── delta-tracker.service.ts  ← Segment-level itinerary diff computation
│   │   └── tools/
│   │       ├── context-compressor.service.ts ← RTK equivalent: compresses all API + LLM output
│   │       ├── search/
│   │       │   ├── search-flights.tool.ts      → Amadeus → compressor → compressed JSON
│   │       │   ├── search-hotels.tool.ts        → Booking.com + Qdrant → compressor
│   │       │   └── search-activities.tool.ts    → Qdrant / Places → compressor
│   │       ├── planning/
│   │       │   ├── assemble-itinerary.tool.ts  → LLM (Haiku) → Itinerary JSON
│   │       │   ├── detect-conflicts.tool.ts    → Rule-based (no LLM cost)
│   │       │   └── resolve-conflict.tool.ts    → LLM (Haiku / Sonnet) → updated Itinerary
│   │       ├── changes/
│   │       │   ├── handle-flight-change.tool.ts → Updates flight segment + affected IDs
│   │       │   └── propagate-downstream.tool.ts → Runs detect_conflicts on modified itinerary
│   │       └── memory/
│   │           ├── store-preference.tool.ts    → Qdrant upsert
│   │           └── recall-preferences.tool.ts  → Qdrant semantic search
│   │
│   ├── search/
│   │   ├── amadeus/amadeus.service.ts    ← Real Amadeus API + mock fallback
│   │   ├── booking/booking.service.ts    ← Real Booking.com + Qdrant hybrid + mock fallback
│   │   └── activities.service.ts         ← Qdrant semantic search + mock fallback
│   │
│   ├── memory/
│   │   ├── qdrant.service.ts             ← Qdrant REST client
│   │   └── embeddings.service.ts         ← Voyage AI / text-embedding-3-small wrapper
│   │
│   ├── cache/redis.service.ts            ← Redis client + `getOrSearch` TTL cache helper
│   └── llm/
│       ├── llm.service.ts                ← Unified LLM wrapper (Anthropic / Gemini)
│       └── token-tracker.service.ts      ← Per-node token breakdown + observability
```

---

## Agent Flow (LangGraph State Machine)

```
User Brief (natural language)
        │
        ▼ Route: if changeRequest → change_manager; else → intent_parser
        │
┌───────────────────┐
│   intent_parser   │  Model: Haiku
│                   │  Builds stable-prefix/dynamic-tail via ContextManagerService
│                   │  Output: TravelBrief (structured JSON)
│                   │  Token tracking: ✅
└───────────────────┘
        │
        ▼ Route: parsedBrief present → search_orchestrator; errors → responder
        │
┌───────────────────────────┐
│   search_orchestrator     │  No LLM — pure parallel API calls
│                           │  Promise.allSettled([flights, hotels, activities])
│                           │  Each tool: raw API → compressor → compressed JSON
│                           │  RTK compression tracked (beforeBytes / afterBytes)
│                           │  Token tracking: ✅ (tool_calls_only model)
└───────────────────────────┘
        │
        ▼ Always → itinerary_assembler
        │
┌──────────────────────────┐
│   itinerary_assembler    │  Model: Haiku
│                          │  Receives compressed search results (not raw API JSON)
│                          │  Output: Itinerary JSON → compressed → compressedContext
│                          │  Token tracking: ✅
└──────────────────────────┘
        │
        ▼ Always → conflict_resolver
        │
┌──────────────────────────┐
│   conflict_resolver      │  Step 1: Rule-based checks (no LLM cost)
│   (loop: max 5 iters)    │    CHECK_IN_BEFORE_LANDING
│                          │    TIGHT_CONNECTION
│                          │    ACTIVITY_OVERLAP
│                          │    HOTEL_GAP
│                          │    CHECKOUT_BEFORE_FLIGHT
│                          │    BUDGET_EXCEEDED
│                          │  Step 2: LLM resolution (Haiku, or Sonnet for complex)
│                          │  Output: updated Itinerary → compressed → compressedContext
│                          │  Token tracking: ✅
└──────────────────────────┘
        │
        ▼ Loop if unresolved && iterations < 5; else → responder
        │
┌───────────────┐
│   responder   │  Terminal node — marks status: "done"
└───────────────┘
        │
      __end__

--- Change Management Path ---

changeRequest present → change_manager
┌──────────────────────────┐
│   change_manager         │  Model: Sonnet
│                          │  Calls handle-flight-change.tool / hotel cancel logic
│                          │  Calls propagate-downstream.tool (→ detect_conflicts)
│                          │  Delta → compressed → compressedContext
│                          │  Token tracking: ✅
└──────────────────────────┘
        │
        ▼ Always → conflict_resolver (to resolve downstream conflicts)
```

---

## RTK Integration — How It Works

The RTK (API Response Compression) pattern is integrated at every stage of the pipeline:

```
Raw API Response (50–200 KB)
        │
        ▼ (search tools only)
ContextCompressorService.compressToolResult("search_flights", raw)
        │   ├─ Tries RTK binary if RTK_ENABLED=true
        │   └─ Falls back to TypeScript compressor (always available)
        ▼
Compressed JSON string (~500–2,000 bytes)
        │
        ▼ Stored in graph state as flightOptions / hotelOptions / activityOptions
        │
LLM node (assembler, resolver, change_manager) receives compressed data
        │
        ▼ LLM output (Itinerary / Resolution JSON) → also compressed
compressor.compressToolResult("assemble_itinerary", itinerary)
        │
        ▼ Compressed snapshot → state.compressedContext (~150 tokens)
        │   Full Itinerary object remains in state.itinerary for rule-based ops
```

**Compression targets achieved:**
| Data | Before | After | Reduction |
|------|--------|-------|-----------|
| Amadeus flights (3 options) | ~48 KB | ~800 bytes | 98.3% |
| Booking.com hotels (3 options) | ~30 KB | ~600 bytes | 98.0% |
| Activities (3 options) | ~15 KB | ~400 bytes | 97.3% |
| Assembled itinerary (context) | ~20 KB | ~600 bytes | 97.0% |

---

## Tool Definitions

### `search_flights`

**Input**: `{ origin, destination, date, travellers, preferredClass? }`  
**Pipeline**: `AmadeusService.searchFlights()` → `ContextCompressorService.compressFlightResponse()` → compressed JSON string  
**Returns**: `{ result: string, savings: { beforeBytes, afterBytes, rtkUsed } }`

### `search_hotels`

**Input**: `{ destination, checkIn, checkOut, guests, accommodationType? }`  
**Pipeline**: `BookingService.searchHotels()` (Qdrant hybrid + Booking.com) → `ContextCompressorService.compressHotelResponse()` → compressed JSON string  
**Returns**: `{ result: string, savings: { beforeBytes, afterBytes, rtkUsed } }`

### `search_activities`

**Input**: `{ destination, startDate, endDate, interests? }`  
**Pipeline**: `ActivitiesService.searchActivities()` (Qdrant semantic) → `ContextCompressorService.compressActivityResponse()` → compressed JSON string  
**Returns**: `{ result: string, savings: { beforeBytes, afterBytes, rtkUsed } }`

### `assemble_itinerary`

**Input**: `{ brief, flightOptions, hotelOptions, activityOptions }` (all already compressed)  
**Pipeline**: LLM (Haiku) with structured output prompt → Itinerary JSON  
**Returns**: `Itinerary` object

### `detect_conflicts`

**Input**: `{ itinerary: Itinerary }`  
**Pipeline**: Pure TypeScript rule engine (no LLM) → deterministic conflict detection  
**Returns**: `{ conflicts: Conflict[] }`  
**Conflict types detected**: `CHECK_IN_BEFORE_LANDING`, `TIGHT_CONNECTION`, `ACTIVITY_OVERLAP`, `HOTEL_GAP`, `CHECKOUT_BEFORE_FLIGHT`, `BUDGET_EXCEEDED`

### `resolve_conflict`

**Input**: `{ conflict, itinerary, resolutionStrategy }`  
**Pipeline**: LLM (Haiku, escalates to Sonnet for complex cases) → updated Itinerary + explanation  
**Returns**: `{ itinerary: Itinerary, explanation: string }`

### `handle_flight_change`

**Input**: `{ itinerary, segmentId, changeType: "delay" | "cancellation" | "date_change", newTime? }`  
**Pipeline**: Pure TypeScript — updates flight status/times and returns affected segment IDs  
**Returns**: `{ affectedSegmentIds: string[], updatedFlight: Flight | null }`

### `propagate_downstream`

**Input**: `{ itinerary, changedSegmentId, affectedSegmentIds }`  
**Pipeline**: Runs `detect_conflicts` on the modified itinerary, filters to affected segments  
**Returns**: `{ conflicts: Conflict[] }`

---

## Shared Types (`src/common/types/travel.types.ts`)

```typescript
interface TravelBrief {
  origin: string; // IATA code or city
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
  travellers: number;
  budgetMin: number;
  budgetMax: number;
  currency: string;
  accommodationPrefs: string[];
  specialRequirements: string[];
  interests: string[];
}

interface Flight {
  id: string;
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departTime: string; // ISO datetime
  arriveTime: string; // ISO datetime
  durationMins: number;
  stops: number;
  pricePerPerson: number;
  totalPrice: number;
  bookingRef: string;
  status: "scheduled" | "delayed" | "cancelled";
}

interface Hotel {
  id: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number };
  stars: number;
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  checkInTime: string; // "15:00"
  checkOutTime: string; // "11:00"
  pricePerNight: number;
  totalPrice: number;
  amenities: string[];
  bookingRef: string;
}

interface Activity {
  id: string;
  name: string;
  type: "attraction" | "restaurant" | "transport" | "excursion" | "free_time";
  date: string;
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
  durationMins: number;
  cost: number;
  location: string;
  notes: string;
  bookingRequired: boolean;
}

interface Itinerary {
  id: string;
  brief: TravelBrief;
  outboundFlight?: Flight;
  returnFlight?: Flight;
  hotel?: Hotel;
  activities: Activity[];
  days: DayPlan[];
  totalCost: number;
  createdAt: string;
  status: TripStatus; // from Prisma enum
}

interface Conflict {
  id: string;
  conflictType:
    | "CHECK_IN_BEFORE_LANDING"
    | "TIGHT_CONNECTION"
    | "ACTIVITY_OVERLAP"
    | "HOTEL_GAP"
    | "CHECKOUT_BEFORE_FLIGHT"
    | "TRANSPORT_TIME_INSUFFICIENT"
    | "BUDGET_EXCEEDED";
  severity: "critical" | "warning";
  affectedItems: string[];
  description: string;
  suggestedFix: string;
}
```

---

## Conflict Resolution Rules (Auto-enforced)

| Conflict                  | Rule                                                  | Auto-fix Strategy |
| ------------------------- | ----------------------------------------------------- | ----------------- |
| `CHECK_IN_BEFORE_LANDING` | Hotel check-in must be ≥ 2 hours after flight arrives | `adjust_times`    |
| `TIGHT_CONNECTION`        | Layover < 60 min domestic, < 90 min international     | `replace_flight`  |
| `ACTIVITY_OVERLAP`        | Two activities with overlapping time windows          | `adjust_times`    |
| `HOTEL_GAP`               | Night with no accommodation                           | `replace_hotel`   |
| `CHECKOUT_BEFORE_FLIGHT`  | Hotel checkout > 6 hours before return flight         | `add_buffer`      |
| `BUDGET_EXCEEDED`         | Total cost > budgetMax                                | `replace_hotel`   |

---

## Change Management Scenarios

### Flight Cancellation

1. `handleFlightChangeTool` marks flight `status: "cancelled"`
2. Adds hotel + all activities to `affectedSegmentIds` (outbound cancels entire Day 1+)
3. `propagateDownstreamTool` runs `detectConflicts` on modified itinerary
4. `conflictResolver` loop re-runs to fix downstream conflicts

### Flight Delay

1. `handleFlightChangeTool` updates `departTime`/`arriveTime`, status: `"delayed"`
2. `propagateDownstreamTool` detects `CHECK_IN_BEFORE_LANDING` and `ACTIVITY_OVERLAP`
3. `conflictResolver` resolves via `adjust_times` strategy

### Date Change

1. Full itinerary rebuild: re-runs `search_orchestrator` → `itinerary_assembler`
2. Old itinerary segments marked as stale by `DeltaTrackerService`
3. Price diff surfaced in `thoughtLog`

---

## Mock Data Strategy

All mock generators live in `src/common/mock/travel-mock-data.ts`:

- `generateMockFlights(req)` — Amadeus-format response, **planted conflict**: flight arrives at 17:45
- `generateMockHotels(req)` — Internal hotel list, **planted conflict**: hotel check-in opens at 15:00
- `generateMockActivities(req)` — Activity list with correct non-overlapping times (for baseline)

Services (`AmadeusService`, `BookingService`, `ActivitiesService`) import from this file and
call the pure functions when API keys are absent. The service classes contain zero mock data.

---

## Implementation Notes

- **Parallel search**: `Promise.allSettled()` in `nodeSearchOrchestrator` — 3–4× latency win
- **Tool loop guard**: Conflict resolver loops max 5 iterations (tracked via `resolvedConflicts.length`)
- **State**: LangGraph `StateAnnotation` with typed reducers — arrays use `concat`, scalars use `replace`
- **Streaming**: SSE endpoint available for real-time itinerary assembly events
- **Config**: All API keys via `ConfigService` from `.env` — never hardcoded
- **RTK_ENABLED**: Set to `true` to attempt RTK binary; automatically falls back to TS compressors

---

## Evaluation Checklist

- [ ] Intent parser extracts all constraint fields from the demo brief
- [ ] Parallel search returns ≥ 3 flight options and ≥ 3 hotel options
- [ ] Assembled itinerary has no unresolved timing conflicts
- [ ] Planted `CHECK_IN_BEFORE_LANDING` conflict is detected and resolved automatically
- [ ] Resolution explanation appears in `thoughtLog` and `resolvedConflicts`
- [ ] Flight cancellation triggers full downstream re-evaluation via propagation
- [ ] Revised itinerary after cancellation is logically valid
- [ ] `compressedContext` is populated after assembler and resolver nodes
- [ ] `tokenTracker.trackCall()` is called in every graph node
- [ ] All mock data imported from `src/common/mock/travel-mock-data.ts`

---

## Bonus Features

1. **Real-time flight status polling**: Poll mock status endpoint every 30 seconds; surface delay alerts automatically
2. **Cost optimiser**: After assembly, secondary search pass to find 10%+ savings without new conflicts
3. **PDF itinerary export**: Export full itinerary as formatted PDF
