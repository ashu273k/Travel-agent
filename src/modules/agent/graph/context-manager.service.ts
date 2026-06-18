import { Injectable, Logger } from "@nestjs/common";
import {
  TravelAgentState,
  ToolCallEntry,
  ThoughtEntry,
} from "../../../common/types/agent.types";

@Injectable()
export class ContextManagerService {
  private readonly logger = new Logger(ContextManagerService.name);
  private readonly MAX_VERBATIM_TOOL_CALLS = 3;

  buildCachedPayload(
    state: TravelAgentState,
    systemRole: string,
    toolSchemas: any[],
  ): {
    systemPrompt: string;
    userPrompt: string;
  } {
    const systemPrompt = [
      systemRole,
      "## Tools Available",
      JSON.stringify(toolSchemas, null, 2),
      "## Travel Domain Conventions",
      "- All flight departure/arrival times are localized.",
      "- Layover times must be minimum 90 minutes for international connection and 60 minutes for domestic connection.",
      "- Hotel check-in time is typically 14:00/15:00 and check-out is 11:00/12:00. Watch for gaps between landing and check-in.",
      "- Budget constraints are primary boundaries. Swapping or downgrading elements is preferred over budget overruns.",
    ].join("\n\n");

    const dynamicTailParts = [
      `Today's Date: ${new Date().toISOString().split("T")[0]}`,
      `Trip Session ID: ${state.sessionId}`,
      `Current User Brief: "${state.rawBrief}"`,
      this.buildTaskStateSummary(state),
      this.buildSlidingWindowContext(state.toolCallLog),
      this.buildRecentThoughtsSummary(state.thoughtLog),
    ];

    if (state.conflicts && state.conflicts.length > 0) {
      dynamicTailParts.push(
        "## Active Conflicts Detected",
        JSON.stringify(state.conflicts, null, 2),
      );
    }

    const userPrompt = dynamicTailParts.join("\n\n");

    return { systemPrompt, userPrompt };
  }

  buildSlidingWindowContext(toolCallLog: ToolCallEntry[]): string {
    if (!toolCallLog || toolCallLog.length === 0) return "";

    const totalCalls = toolCallLog.length;
    const verbatimCalls = toolCallLog.slice(-this.MAX_VERBATIM_TOOL_CALLS);
    const olderCalls = toolCallLog.slice(0, -this.MAX_VERBATIM_TOOL_CALLS);

    const parts: string[] = [];

    if (olderCalls.length > 0) {
      parts.push("### Prior Action Summary");
      const olderSummary = olderCalls
        .map(
          (tc, idx) =>
            `Step ${idx + 1}: Executed tool [${tc.tool}] successfully at ${tc.timestamp}.`,
        )
        .join("\n");
      parts.push(olderSummary);
    }

    parts.push(
      `### Verbatim Recent Tool Outputs (Last ${verbatimCalls.length} calls)`,
    );
    const recentVerbatim = verbatimCalls
      .map((tc, idx) => {
        const stepNum = olderCalls.length + idx + 1;
        return [
          `Step ${stepNum}: Tool [${tc.tool}]`,
          `Input: ${JSON.stringify(tc.input)}`,
          `Output:\n${tc.output}`,
        ].join("\n");
      })
      .join("\n\n");
    parts.push(recentVerbatim);

    return parts.join("\n\n");
  }

  private buildTaskStateSummary(state: TravelAgentState): string {
    const brief = state.parsedBrief;
    const itinerary = state.itinerary;

    const briefSummary = brief
      ? `Origin: ${brief.origin} | Dest: ${brief.destination} | Dates: ${brief.departureDate} to ${brief.returnDate || "N/A"} | Budget Max: ${brief.budgetMax} ${brief.currency}`
      : "Unparsed";

    const itinSummary = itinerary
      ? `Assembled segments: Outbound Flight: ${itinerary.outboundFlight ? "Yes" : "No"} | Hotel: ${itinerary.hotel ? "Yes" : "No"} | Activities Count: ${itinerary.activities?.length || 0} | Total Cost: ${itinerary.totalCost}`
      : "No Itinerary Drafted Yet";

    return [
      "## Current Planning State",
      `Constraints: ${briefSummary}`,
      `Itinerary status: ${itinSummary}`,
      `Current Active Node: ${state.currentNode}`,
      `Overall Agent Status: ${state.status}`,
    ].join("\n");
  }

  private buildRecentThoughtsSummary(thoughtLog: ThoughtEntry[]): string {
    if (!thoughtLog || thoughtLog.length === 0) return "";
    const recentThoughts = thoughtLog.slice(-3);
    return [
      "## Agent Thinking History (Recent Steps)",
      recentThoughts
        .map((t) => `[${t.nodeName}] at ${t.timestamp}: ${t.thought}`)
        .join("\n"),
    ].join("\n");
  }
}
