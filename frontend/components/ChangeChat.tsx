"use client";

import { useState } from "react";
import { X, Send, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { requestChange } from "@/lib/api";

interface ChangeChatProps {
  sessionId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const CHANGE_TYPES = [
  { value: "flight_delay", label: "Flight Delay" },
  { value: "flight_cancellation", label: "Flight Cancellation" },
  { value: "date_change", label: "Date Change" },
  { value: "hotel_cancellation", label: "Hotel Cancellation" },
  { value: "activity_change", label: "Activity Change" },
  { value: "passenger_change", label: "Passenger Change" },
];

type SubmitStatus = "idle" | "loading" | "success" | "error";

export default function ChangeChat({ sessionId, onClose, onSuccess }: ChangeChatProps) {
  const [changeType, setChangeType] = useState(CHANGE_TYPES[0].value);
  const [bookingRef, setBookingRef] = useState("");
  const [notes, setNotes] = useState("");
  const [newDate, setNewDate] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingRef.trim()) {
      setErrorMsg("Please enter a booking reference.");
      return;
    }
    setStatus("loading");
    setErrorMsg(null);

    try {
      const newDetails: Record<string, unknown> = {};
      if (notes) newDetails.notes = notes;
      if (newDate) newDetails.newDate = newDate;

      await requestChange(sessionId, changeType, bookingRef.trim(), newDetails);
      setStatus("success");
      onSuccess?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to submit change request. Please try again."
      );
      setStatus("error");
    }
  };

  const handleReset = () => {
    setChangeType(CHANGE_TYPES[0].value);
    setBookingRef("");
    setNotes("");
    setNewDate("");
    setStatus("idle");
    setErrorMsg(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md bg-white shadow-2xl flex flex-col h-full animate-slide-up">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-bold text-lg">Request a Change</h2>
              <p className="text-indigo-200 text-sm mt-0.5">
                Let our AI handle your modification
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-xl transition"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {status === "success" ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-12">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="text-emerald-500" size={40} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">
                  Change Requested!
                </h3>
                <p className="text-slate-500 text-sm max-w-xs">
                  Your change request has been submitted. Our AI will process it and update your
                  itinerary shortly.
                </p>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleReset}
                  className="px-5 py-2.5 bg-indigo-50 text-indigo-600 font-medium rounded-xl text-sm hover:bg-indigo-100 transition"
                >
                  Make Another
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 bg-indigo-600 text-white font-medium rounded-xl text-sm hover:bg-indigo-700 transition"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Change type */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Change Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CHANGE_TYPES.map((ct) => (
                    <button
                      key={ct.value}
                      type="button"
                      onClick={() => setChangeType(ct.value)}
                      className={`text-left p-3 rounded-xl border text-sm font-medium transition-all duration-200 ${
                        changeType === ct.value
                          ? "bg-indigo-50 border-indigo-400 text-indigo-700"
                          : "bg-white border-slate-200 text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
                      }`}
                    >
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Booking ref */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Booking Reference{" "}
                  <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={bookingRef}
                  onChange={(e) => setBookingRef(e.target.value)}
                  placeholder="e.g. BK-123456"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Find this on your itinerary card below the flight or hotel details.
                </p>
              </div>

              {/* New date (for date changes) */}
              {(changeType === "date_change" || changeType === "flight_delay") && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    New Date{" "}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  />
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Additional Details{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Describe what you need changed, any preferences, or special requirements..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition leading-relaxed"
                />
              </div>

              {/* Error */}
              {errorMsg && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700">{errorMsg}</p>
                </div>
              )}

              {/* Info box */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <p className="text-xs text-blue-700 font-medium mb-1">How it works</p>
                <p className="text-xs text-blue-600">
                  Our AI will process your change, search for alternatives, detect any
                  conflicts, and update your itinerary automatically.
                </p>
              </div>

              <button
                type="submit"
                disabled={status === "loading"}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {status === "loading" ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    Submit Change Request
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
