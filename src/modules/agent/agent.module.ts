import { Module, Global } from "@nestjs/common";
import { ContextCompressorService } from "./tools/context-compressor.service";
import { ContextManagerService } from "./graph/context-manager.service";
import { DeltaTrackerService } from "./graph/delta-tracker.service";

// Tools — search
import { SearchFlightsTool } from "./tools/search/search-flights.tool";
import { SearchHotelsTool } from "./tools/search/search-hotels.tool";
import { SearchActivitiesTool } from "./tools/search/search-activities.tool";

// Tools — planning
import { AssembleItineraryTool } from "./tools/planning/assemble-itinerary.tool";
import { DetectConflictsTool } from "./tools/planning/detect-conflicts.tool";
import { ResolveConflictTool } from "./tools/planning/resolve-conflict.tool";

// Tools — memory
import { StorePreferenceTool } from "./tools/memory/store-preference.tool";
import { RecallPreferencesTool } from "./tools/memory/recall-preferences.tool";

// Tools — change management
import { HandleFlightChangeTool } from "./tools/changes/handle-flight-change.tool";
import { PropagateDownstreamTool } from "./tools/changes/propagate-downstream.tool";
import { PatchSegmentTool } from "./tools/changes/patch-segment.tool";

// Graph (depends on all tools above)
import { TravelGraphService } from "./graph/travel-graph";

// Module dependencies
import { SearchModule } from "../search/search.module";
import { LlmModule } from "../llm/llm.module";
import { TripsModule } from "../trips/trips.module";
import { MemoryModule } from "../memory/memory.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Global()
@Module({
  imports: [
    SearchModule,
    LlmModule,
    TripsModule,
    MemoryModule, // Provides SemanticCacheService + ItineraryTemplateService
    NotificationsModule, // Provides SseService for real-time streaming
  ],
  providers: [
    // Context layer — resolved before graph
    ContextCompressorService,
    ContextManagerService,
    DeltaTrackerService,
    // Search tools
    SearchFlightsTool,
    SearchHotelsTool,
    SearchActivitiesTool,
    // Planning tools
    AssembleItineraryTool,
    DetectConflictsTool,
    ResolveConflictTool,
    // Memory tools
    StorePreferenceTool,
    RecallPreferencesTool,
    // Change management tools
    HandleFlightChangeTool,
    PropagateDownstreamTool,
    PatchSegmentTool, // Phase 4: delta-only segment patching
    // Graph (depends on all of the above)
    TravelGraphService,
  ],
  exports: [
    ContextCompressorService,
    ContextManagerService,
    DeltaTrackerService,
    SearchFlightsTool,
    SearchHotelsTool,
    SearchActivitiesTool,
    AssembleItineraryTool,
    DetectConflictsTool,
    ResolveConflictTool,
    StorePreferenceTool,
    RecallPreferencesTool,
    HandleFlightChangeTool,
    PropagateDownstreamTool,
    PatchSegmentTool,
    TravelGraphService,
  ],
})
export class AgentModule {}
