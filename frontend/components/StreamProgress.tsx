"use client";

import { CheckCircle2, Circle, Loader2, AlertTriangle, Plane } from "lucide-react";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface PipelineStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
}

interface StreamProgressProps {
  steps: PipelineStep[];
  conflictCount?: number;
}

function StepDot({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="text-emerald-500 flex-shrink-0" size={20} />;
    case "active":
      return <Loader2 className="text-indigo-500 animate-spin flex-shrink-0" size={20} />;
    case "error":
      return <AlertTriangle className="text-red-500 flex-shrink-0" size={20} />;
    default:
      return <Circle className="text-slate-200 flex-shrink-0" size={20} />;
  }
}

const ACTIVE_MESSAGES: Record<string, string[]> = {
  parse: ["Reading your travel brief…", "Understanding your preferences…", "Identifying destinations…"],
  search: ["Scanning live flight data…", "Comparing hotel options…", "Finding the best deals…"],
  assemble: ["Building your day-by-day plan…", "Scheduling activities…", "Optimising your itinerary…"],
  conflicts: ["Checking for scheduling conflicts…", "Resolving time overlaps…", "Finalising bookings…"],
  done: ["Almost there…", "Polishing the details…"],
};

function getActiveMessage(stepId: string): string {
  const msgs = ACTIVE_MESSAGES[stepId] ?? ["Working…"];
  return msgs[Math.floor(Date.now() / 3000) % msgs.length];
}

export default function StreamProgress({ steps, conflictCount }: StreamProgressProps) {
  const doneCount = steps.filter((s) => s.status === "done").length;
  const progress = Math.round((doneCount / steps.length) * 100);
  const activeStep = steps.find((s) => s.status === "active");

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-8 text-center">
        {/* Animated plane */}
        <div className="relative w-16 h-16 mx-auto mb-4">
          <div className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
          <div className="relative w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
            <Plane className="text-white" size={28} />
          </div>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">Planning your trip</h2>
        <p className="text-indigo-200 text-sm">
          {activeStep ? getActiveMessage(activeStep.id) : "Preparing your itinerary…"}
        </p>
      </div>

      {/* Progress bar */}
      <div className="px-8 pt-6">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span>{doneCount} of {steps.length} steps complete</span>
          <span className="font-semibold text-indigo-600">{progress}%</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="p-6 space-y-1">
        {steps.map((step, idx) => (
          <div key={step.id} className="relative">
            {/* Connector */}
            {idx < steps.length - 1 && (
              <div
                className={`absolute left-[9px] top-[28px] w-0.5 h-5 transition-colors duration-500 ${
                  step.status === "done" ? "bg-emerald-200" : "bg-slate-100"
                }`}
              />
            )}

            <div
              className={`flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${
                step.status === "active"
                  ? "bg-indigo-50"
                  : step.status === "done"
                  ? ""
                  : ""
              }`}
            >
              <div className="mt-0.5">
                <StepDot status={step.status} />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium transition-all duration-300 ${
                    step.status === "active"
                      ? "text-indigo-700"
                      : step.status === "done"
                      ? "text-slate-500"
                      : "text-slate-300"
                  }`}
                >
                  {step.label}
                </p>
                {step.status === "active" && (
                  <p className="text-xs text-indigo-400 mt-0.5">{step.description}</p>
                )}
                {step.status === "done" && step.id === "conflicts" && (
                  <p className="text-xs text-emerald-500 mt-0.5">
                    {conflictCount === 0 || conflictCount === undefined
                      ? "No conflicts found"
                      : `${conflictCount} conflict${conflictCount > 1 ? "s" : ""} resolved`}
                  </p>
                )}
              </div>
              {step.status === "active" && (
                <div className="flex gap-0.5 mt-1.5 flex-shrink-0">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce"
                      style={{ animationDelay: `${i * 100}ms` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="px-6 pb-6">
        <p className="text-center text-slate-400 text-xs">
          Usually takes 10–30 seconds · Sit tight!
        </p>
      </div>
    </div>
  );
}
