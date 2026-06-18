"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plane,
  Sparkles,
  Loader2,
  ChevronRight,
  MapPin,
  Users,
  Calendar,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { submitBrief } from "@/lib/api";

const EXAMPLE_TRIPS: { label: string; brief: string }[] = [
  { label: "Mumbai → Goa", brief: "Mumbai to Goa for 4 days in August, 2 people, budget ₹40,000. Beach, seafood, water sports." },
  { label: "Delhi → Manali", brief: "Delhi to Manali for 6 days in July, 4 friends, budget ₹60,000-80,000. Adventure trekking, Rohtang Pass." },
  { label: "Bangalore → Dubai", brief: "Bangalore to Dubai for 5 days in December, 2 adults, budget ₹1.5L. Sightseeing, shopping, desert safari." },
  { label: "Chennai → Bangkok", brief: "Chennai to Bangkok for 7 days in September, couple, budget ₹1L-1.5L. Temples, street food, Chatuchak market." },
  { label: "Mumbai → Paris", brief: "Mumbai to Paris for 8 days in October, 2 adults, budget ₹2.5L-3L. Art, history, fine dining, Eiffel Tower." },
];

const FEATURES = [
  { icon: "✈️", label: "Real flight search" },
  { icon: "🏨", label: "Hotel recommendations" },
  { icon: "🗺️", label: "Day-by-day itinerary" },
  { icon: "⚡", label: "Conflict detection" },
  { icon: "🤖", label: "AI-powered" },
];

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  // Structured detail fields
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [travellers, setTravellers] = useState(2);

  const handleExampleClick = (example: string) => {
    setBrief(example);
    setError(null);
    // Scroll briefly to textarea
    const ta = document.querySelector("textarea");
    ta?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let briefText = brief.trim();

    // If structured details are filled, append them to the brief
    if (showDetails && (origin || destination || departureDate)) {
      const extras: string[] = [];
      if (origin) extras.push(`from ${origin}`);
      if (destination) extras.push(`to ${destination}`);
      if (departureDate) extras.push(`departing ${departureDate}`);
      if (returnDate) extras.push(`returning ${returnDate}`);
      if (travellers > 0) extras.push(`${travellers} traveller${travellers > 1 ? "s" : ""}`);
      if (extras.length > 0) {
        briefText = briefText
          ? `${briefText}. Trip details: ${extras.join(", ")}.`
          : `I want to travel ${extras.join(", ")}.`;
      }
    }

    if (!briefText) {
      setError("Please describe your trip or use one of the examples above.");
      return;
    }

    setLoading(true);
    try {
      const userId = `user_${Math.random().toString(36).slice(2, 10)}`;
      const { sessionId, tripId } = await submitBrief(userId, briefText);
      router.push(`/trip/${tripId}?session=${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen relative overflow-hidden bg-slate-900">
      {/* Background gradient mesh */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950" />
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-indigo-600 opacity-10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-violet-600 opacity-10 blur-[100px]" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-16">
        {/* Logo/Nav */}
        <div className="absolute top-6 left-6 flex items-center gap-2">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2">
            <Plane className="text-white" size={18} />
          </div>
          <span className="text-white font-bold text-sm tracking-tight">TravelAI</span>
        </div>

        {/* Hero */}
        <div className="text-center mb-12 max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-full px-4 py-1.5 text-sm text-white/70 mb-6">
            <Sparkles size={14} className="text-yellow-400" />
            Powered by AI — plan any trip in seconds
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-white mb-5 leading-[1.1] tracking-tight">
            Where do you
            <span className="block bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              want to go?
            </span>
          </h1>
          <p className="text-slate-400 text-lg md:text-xl max-w-lg mx-auto leading-relaxed">
            Describe your trip in plain English. Our AI finds flights, books hotels, and builds a complete itinerary.
          </p>
        </div>

        {/* Main card */}
        <div className="w-full max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Brief input */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-1 focus-within:border-indigo-500/50 transition-all duration-200">
              <textarea
                value={brief}
                onChange={(e) => { setBrief(e.target.value); setError(null); }}
                rows={4}
                placeholder="e.g. I want to fly from Mumbai to Goa for 4 days in August 2026, 2 adults, budget around ₹40,000. Looking for beach activities and good seafood."
                className="w-full bg-transparent px-5 py-4 text-white placeholder-white/30 text-sm resize-none focus:outline-none leading-relaxed"
              />
              <div className="flex items-center justify-between px-4 pb-3">
                <span className="text-white/30 text-xs">
                  {brief.length > 0 ? `${brief.length} chars` : "Be as detailed as you like"}
                </span>
                <button
                  type="button"
                  onClick={() => setBrief("")}
                  className={`text-white/30 hover:text-white/60 text-xs transition ${brief ? "visible" : "invisible"}`}
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Example chips */}
            <div>
              <p className="text-white/40 text-xs mb-2 px-1">Try an example:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_TRIPS.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleExampleClick(ex.brief)}
                    className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/60 hover:text-white/90 px-3 py-1.5 rounded-full transition-all duration-150"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional details toggle */}
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-white/50 hover:text-white/80 text-sm transition w-full px-1"
            >
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${showDetails ? "rotate-180" : ""}`}
              />
              {showDetails ? "Hide" : "Add"} structured details
            </button>

            {/* Structured details */}
            {showDetails && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-5 space-y-4 animate-fade-in">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-xs font-medium mb-1.5 flex items-center gap-1">
                      <MapPin size={11} /> From
                    </label>
                    <input
                      type="text"
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      placeholder="Mumbai"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-indigo-500/50 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-white/50 text-xs font-medium mb-1.5 flex items-center gap-1">
                      <MapPin size={11} /> To
                    </label>
                    <input
                      type="text"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="Paris"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-indigo-500/50 transition"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/50 text-xs font-medium mb-1.5 flex items-center gap-1">
                      <Calendar size={11} /> Departure
                    </label>
                    <input
                      type="date"
                      value={departureDate}
                      onChange={(e) => setDepartureDate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500/50 transition [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="block text-white/50 text-xs font-medium mb-1.5 flex items-center gap-1">
                      <Calendar size={11} /> Return <span className="text-white/30">(opt.)</span>
                    </label>
                    <input
                      type="date"
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500/50 transition [color-scheme:dark]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-white/50 text-xs font-medium mb-2 flex items-center gap-1">
                    <Users size={11} /> Travellers
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setTravellers(Math.max(1, travellers - 1))}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-lg flex items-center justify-center transition"
                    >
                      −
                    </button>
                    <span className="text-white font-bold w-6 text-center">{travellers}</span>
                    <button
                      type="button"
                      onClick={() => setTravellers(travellers + 1)}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-lg flex items-center justify-center transition"
                    >
                      +
                    </button>
                    <span className="text-white/40 text-sm">{travellers === 1 ? "adult" : "adults"}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all duration-200 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 disabled:opacity-60 disabled:cursor-not-allowed text-base"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Planning your trip…
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Plan My Trip
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Feature badges */}
          <div className="flex flex-wrap gap-2 justify-center mt-8">
            {FEATURES.map((f) => (
              <div
                key={f.label}
                className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1 text-white/50 text-xs"
              >
                <span>{f.icon}</span>
                {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
