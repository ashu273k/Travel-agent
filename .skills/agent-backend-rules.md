# Travel Agent Backend — Agent Coding Guidelines & LLD/SOLID Principles

This document contains rules, design guidelines, and best practices for developing
the agentic Travel Planning System backend. Every agent working on this project must
strictly adhere to these practices.

---

## 1. Low-Level Design (LLD) & SOLID Principles

### Single Responsibility Principle (SRP)

- Each class, service, and controller must have exactly one reason to change.
- **Do not mix concerns**: The LLM Orchestrator should not query databases directly,
  make external API search calls, or check Redis cache. It should delegate to specialised services.
- **Mock data lives in one place**: All fallback/mock data generators for flights, hotels,
  and activities must live in `src/common/mock/travel-mock-data.ts`. Services must import
  from this file — never define mock generators inline inside service classes.
- **Separation of controllers & services**: Controllers handle HTTP validation, request
  mapping, and streaming (SSE) serialisation. Services handle orchestration and application
  logic. Repositories handle database operations.

### Open/Closed Principle (OCP)

- Code should be open for extension but closed for modification.
- **Search Providers**: Search providers (Amadeus, Booking.com, Google Places) must implement
  a common interface. Adding a new flight search engine should only require writing a new
  provider class implementing `IFlightSearchProvider`, without modifying the search orchestrator.
- **LLM Providers**: Adding support for a new model or LLM vendor must not require modifying
  the agent graphs. It should be handled by extending the `LLMService` provider factory.
- **Compressors**: Adding compression for a new tool type means adding a new `else if` branch
  in `ContextCompressorService.compressToolResult()` and, if needed, a new domain-specific
  method. Do not modify existing compressor branches.

### Liskov Substitution Principle (LSP)

- Subclasses or implementers of interfaces must be substitutable for their base types.
- Mock implementations of databases, caches, and search engines must behave identically
  to the production clients in tests.

### Interface Segregation Principle (ISP)

- Create small, cohesive interfaces. Instead of a giant `SearchService`, use separate
  `IFlightSearch`, `IHotelSearch`, and `IActivitySearch` interfaces.

### Dependency Inversion Principle (DIP)

- High-level modules must not depend on low-level modules. Both must depend on abstractions.
- **Repository Pattern**: Trips and Session services must depend on repository interfaces
  (e.g., `ITripsRepository`), not concrete `PrismaService` instances.
- **Inversion of Control (IoC)**: Inject all dependencies via constructor parameters.
  Never use `new` inside a service to instantiate database clients, search providers, or LLMs.

---

## 2. LLM Token Optimisation & Latency Guidelines

Token usage is our major operational cost and latency driver. Every LLM interaction must
be optimised at multiple layers, in this priority order:

### Layer 1: API Response Compression (RTK Pattern) — HIGHEST IMPACT

**The RTK pattern for this project means: every raw API response passes through
`ContextCompressorService` before it enters graph state or an LLM prompt.**

Rules:

- **Never feed raw API payloads directly to the LLM.** Raw Amadeus or Booking.com responses
  are verbose 50–200 KB JSON objects that bloat context.
- Every search tool (`search-flights.tool.ts`, `search-hotels.tool.ts`,
  `search-activities.tool.ts`) must call `compressorService.compressToolResult()` and
  return the compressed string, not the raw API response.
- Every graph node that calls an LLM and produces a large JSON output (itinerary assembler,
  conflict resolver, change manager) must also pipe its output through
  `compressor.compressToolResult()` and store the result in `state.compressedContext`.
- The `compressedContext` field is the lightweight snapshot that subsequent LLM calls use.
  The full data remains in graph state for deterministic operations (rule-based conflict
  detection, delta tracking, etc.).
- RTK compression targets:
  - Amadeus flight response: 120 KB → ~800 bytes (99.3% reduction)
  - Booking.com hotel response: 80 KB → ~600 bytes (99.3% reduction)
  - Assembled itinerary (full): ~5,000 tokens → ~150 tokens (97% reduction)
  - Change delta: ~20 tokens (minimal by design)

### Layer 2: Prompt Caching (Stable Prefix / Dynamic Tail)

- Always use `ContextManagerService.buildCachedPayload()` to assemble prompts.
- The `systemPrompt` (stable prefix) contains: role definition, tool schemas, travel domain
  conventions. This part is cacheable by Claude and costs ~90% less after the first call.
- The `userPrompt` (dynamic tail) contains: today's date, session ID, task state summary,
  compressed search results, recent thought log (last 3), and active conflicts.
- **Never** put session IDs, current dates, or user data in the stable prefix.

### Layer 3: Itinerary Deltas

- Use `DeltaTrackerService.calculateDelta()` when sending itinerary updates to the LLM.
- Only send changed segments. Do not re-send the full itinerary on every conflict resolution
  iteration. The `compressedContext` field stores the current lightweight snapshot.

### Layer 4: Session Sliding Window

- Do not re-send the entire conversation history on every agent step.
- Keep a task state summary (goal, constraints, current node, status) on every turn.
- Keep only the last 3 tool call outputs verbatim. Compress older calls to single-line summaries.
- This is handled by `ContextManagerService.buildSlidingWindowContext()`.

### Layer 5: Model Routing

- Route tasks to the cheapest capable model:
  - **Haiku / Gemini Flash**: Intent parsing, data compression, scoring/ranking, simple
    conflict detection.
  - **Sonnet / Claude claude-sonnet-4-6**: Orchestration decisions, complex multi-leg conflict
    resolution, change impact propagation.
- Ensure `tokenTracker.trackCall()` is called in EVERY graph node, recording which model
  was used and the token breakdown by category.

---

## 3. Directory Structure and Boundaries

```
src/
├── common/
│   ├── mock/
│   │   └── travel-mock-data.ts   ← ALL mock/seed data lives here
│   ├── types/
│   │   ├── travel.types.ts       ← Domain types (Flight, Hotel, Activity, Itinerary, Conflict)
│   │   ├── agent.types.ts        ← Agent state types (TravelAgentState, ToolCallEntry, etc.)
│   │   └── search.types.ts       ← Search request types
│   └── ...
├── modules/
│   ├── agent/
│   │   ├── graph/
│   │   │   ├── travel-graph.ts           ← LangGraph state machine (all nodes)
│   │   │   ├── travel-state.ts           ← StateAnnotation definition
│   │   │   ├── context-manager.service.ts ← Stable prefix / dynamic tail builder
│   │   │   └── delta-tracker.service.ts  ← Segment-level itinerary diffs
│   │   └── tools/
│   │       ├── context-compressor.service.ts ← RTK equivalent: all compression logic
│   │       ├── search/           ← Flight/hotel/activity search tools (compress output)
│   │       ├── planning/         ← Assemble/detect-conflicts/resolve tools
│   │       ├── changes/          ← Handle-flight-change / propagate-downstream tools
│   │       └── memory/           ← Store/recall Qdrant preference tools
│   ├── search/
│   │   ├── amadeus/              ← Amadeus API client (no mock data inline)
│   │   └── booking/              ← Booking.com API client (no mock data inline)
│   ├── memory/                   ← Qdrant + embeddings services
│   ├── cache/                    ← Redis client and caching utilities
│   └── llm/                      ← Unified LLM wrapper + token tracker
```

---

## 4. Token Tracking — Required in Every Node

Every graph node must call `this.tokenTracker.trackCall()` with:

- `sessionId`, `nodeName`, `model`
- `inputTokens`: broken down by `prefix`, `compressedAPIs`, `sessionState`, `userRequest`,
  `historyWindow`, `total`
- `outputTokens.total`
- `latencyMs`

This is non-negotiable — without per-node tracking we cannot measure or optimise costs.

---

## 5. Testing & Error Handling

- **Offline Resilience**: When Qdrant, Redis, or Postgres is down, services must fail
  gracefully or fallback to mock providers (imported from `common/mock/travel-mock-data.ts`).
- **Strict Zod Validation**: Validate all incoming briefs, external API responses, and LLM
  structured outputs with strict schemas to eliminate runtime failures.
- **Planted Conflicts**: `travel-mock-data.ts` intentionally plants a `CHECK_IN_BEFORE_LANDING`
  conflict (flight lands at 17:45, hotel check-in opens at 15:00). This must remain intact
  for eval suite assertions.

---

## 6. Compression Routing Reference

When adding a new tool, register its compression in `ContextCompressorService`:

| Tool Name                                  | Compressor Method                           |
| ------------------------------------------ | ------------------------------------------- |
| `search_flights`                           | `compressFlightResponse()`                  |
| `search_hotels`                            | `compressHotelResponse()`                   |
| `search_activities` / `search_restaurants` | `compressActivityResponse()`                |
| `assemble_itinerary` / `resolve_conflict`  | `compressItineraryForContext()`             |
| `change_manager_delta`                     | `compressConflictResolution()`              |
| anything else                              | `cleanGenericObject()` (strips nulls/empty) |
