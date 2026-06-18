"use client";

import type { Itinerary, Flight, Hotel } from "@/lib/types";
import {
  Plane,
  Building2,
  Users,
  IndianRupee,
  ArrowRight,
  Calendar,
  MapPin,
  Star,
  Clock,
  CheckCircle2,
  TrendingUp,
  Zap,
} from "lucide-react";
import DayCard from "./DayCard";

function fmt(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(0)}K`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  if (!timeStr) return "";
  if (timeStr.includes("T")) {
    return new Date(timeStr).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }
  return timeStr;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + "m" : ""}`.trim() : `${m}m`;
}

function FlightCard({ flight, label }: { flight: Flight; label: string }) {
  const statusStyle: Record<Flight["status"], { bg: string; text: string; dot: string }> = {
    scheduled: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
    delayed: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
    cancelled: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  };
  const s = statusStyle[flight.status];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header band */}
      <div className="bg-gradient-to-r from-blue-500 to-sky-500 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plane className="text-white/80" size={14} />
          <span className="text-white text-xs font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <div className={`flex items-center gap-1.5 ${s.bg} rounded-full px-2.5 py-0.5`}>
          <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          <span className={`text-xs font-medium capitalize ${s.text}`}>{flight.status}</span>
        </div>
      </div>

      <div className="p-5">
        {/* Route */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-center">
            <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatTime(flight.departTime)}</p>
            <p className="text-sm font-semibold text-slate-600 mt-1">{flight.origin}</p>
          </div>

          <div className="flex-1 flex flex-col items-center px-4">
            <p className="text-xs text-slate-400 mb-2">
              {formatDuration(flight.durationMins)} ·{" "}
              {flight.stops === 0 ? "Non-stop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`}
            </p>
            <div className="w-full flex items-center gap-1">
              <div className="flex-1 h-px bg-slate-200" />
              <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center">
                <Plane size={12} className="text-blue-400" />
              </div>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <p className="text-xs text-slate-400 mt-2 font-medium">
              {flight.airline} {flight.flightNumber}
            </p>
          </div>

          <div className="text-center">
            <p className="text-3xl font-bold text-slate-900 tabular-nums">{formatTime(flight.arriveTime)}</p>
            <p className="text-sm font-semibold text-slate-600 mt-1">{flight.destination}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <span className="text-slate-400 font-mono text-xs">Ref: {flight.bookingRef}</span>
          {flight.totalPrice > 0 && (
            <div className="flex items-center gap-1 bg-blue-50 rounded-lg px-3 py-1.5">
              <IndianRupee size={13} className="text-blue-600" />
              <span className="font-bold text-blue-700 text-sm">
                {flight.totalPrice.toLocaleString("en-IN")}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HotelCard({ hotel }: { hotel: Hotel }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-violet-500 to-purple-500 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="text-white/80" size={14} />
          <span className="text-white text-xs font-semibold uppercase tracking-wider">Accommodation</span>
        </div>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: hotel.stars }).map((_, i) => (
            <Star key={i} size={11} className="text-yellow-300 fill-yellow-300" />
          ))}
        </div>
      </div>

      <div className="p-5">
        <p className="text-lg font-bold text-slate-900">{hotel.name}</p>
        <p className="flex items-center gap-1 text-slate-500 text-sm mt-1">
          <MapPin size={13} />
          {hotel.address}
        </p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-violet-50 rounded-xl p-3">
            <p className="text-violet-500 text-xs font-semibold uppercase tracking-wider mb-1">Check-in</p>
            <p className="font-bold text-slate-800 text-sm">{formatDate(hotel.checkIn)}</p>
            <p className="text-slate-500 text-xs mt-0.5">{hotel.checkInTime}</p>
          </div>
          <div className="bg-violet-50 rounded-xl p-3">
            <p className="text-violet-500 text-xs font-semibold uppercase tracking-wider mb-1">Check-out</p>
            <p className="font-bold text-slate-800 text-sm">{formatDate(hotel.checkOut)}</p>
            <p className="text-slate-500 text-xs mt-0.5">{hotel.checkOutTime}</p>
          </div>
        </div>

        {hotel.amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {hotel.amenities.map((a) => (
              <span key={a} className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-0.5 rounded-full">
                {a}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
          <span className="text-slate-400 font-mono text-xs">Ref: {hotel.bookingRef}</span>
          {hotel.totalPrice > 0 && (
            <div className="flex items-center gap-1 bg-violet-50 rounded-lg px-3 py-1.5">
              <IndianRupee size={13} className="text-violet-600" />
              <span className="font-bold text-violet-700 text-sm">
                {hotel.totalPrice.toLocaleString("en-IN")} total
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ItineraryViewProps {
  itinerary: Itinerary;
}

export default function ItineraryView({ itinerary }: ItineraryViewProps) {
  const brief = itinerary.brief;
  const flightsCost =
    (itinerary.outboundFlight?.totalPrice ?? 0) +
    (itinerary.returnFlight?.totalPrice ?? 0);
  const hotelCost = itinerary.hotel?.totalPrice ?? 0;
  const activitiesCost = (itinerary.activities ?? []).reduce(
    (sum, a) => sum + (a.cost ?? 0),
    0
  );

  const origin = brief?.origin ?? itinerary.outboundFlight?.origin ?? "—";
  const destination = brief?.destination ?? itinerary.outboundFlight?.destination ?? "—";
  const nights = itinerary.days?.length > 0 ? itinerary.days.length - 1 : undefined;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero card */}
      <div className="relative bg-slate-900 rounded-3xl overflow-hidden shadow-2xl">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-indigo-800 to-violet-900" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-violet-500/10 rounded-full blur-2xl" />

        <div className="relative px-6 md:px-8 py-8">
          {/* Route */}
          <div className="flex items-center gap-4 mb-6">
            <div>
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">From</p>
              <p className="text-3xl md:text-4xl font-extrabold text-white">{origin}</p>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-4 py-2">
                <ArrowRight size={16} className="text-white/60" />
                <Plane size={16} className="text-white" />
                <ArrowRight size={16} className="text-white/60" />
              </div>
            </div>
            <div className="text-right">
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">To</p>
              <p className="text-3xl md:text-4xl font-extrabold text-white">{destination}</p>
            </div>
          </div>

          {/* Trip details row */}
          <div className="flex flex-wrap gap-3 mb-8">
            {brief?.departureDate && (
              <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1.5">
                <Calendar size={13} className="text-white/60" />
                <span className="text-white/80 text-xs font-medium">
                  {formatDate(brief.departureDate)}
                  {brief.returnDate && ` – ${formatDate(brief.returnDate)}`}
                </span>
              </div>
            )}
            {nights && nights > 0 && (
              <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1.5">
                <Clock size={13} className="text-white/60" />
                <span className="text-white/80 text-xs font-medium">{nights} nights</span>
              </div>
            )}
            {brief?.travellers && (
              <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1.5">
                <Users size={13} className="text-white/60" />
                <span className="text-white/80 text-xs font-medium">
                  {brief.travellers} {brief.travellers === 1 ? "traveller" : "travellers"}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 bg-emerald-500/20 rounded-full px-3 py-1.5 border border-emerald-500/30">
              <CheckCircle2 size={13} className="text-emerald-400" />
              <span className="text-emerald-300 text-xs font-semibold capitalize">
                {itinerary.status ?? "Planned"}
              </span>
            </div>
          </div>

          {/* Total cost */}
          <div className="border-t border-white/10 pt-6 flex items-end justify-between">
            <div>
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">Total Trip Cost</p>
              <p className="text-4xl md:text-5xl font-extrabold text-white">
                {formatCurrency(itinerary.totalCost)}
              </p>
              {brief && brief.budgetMax > 0 && (
                <p className={`text-sm mt-1 font-medium ${
                  itinerary.totalCost > brief.budgetMax
                    ? "text-red-300"
                    : itinerary.totalCost > brief.budgetMin
                    ? "text-amber-300"
                    : "text-emerald-300"
                }`}>
                  {itinerary.totalCost > brief.budgetMax
                    ? "↑ Over budget"
                    : itinerary.totalCost > brief.budgetMin
                    ? "Within budget range"
                    : "↓ Under budget"}
                </p>
              )}
            </div>
            <div className="hidden md:flex flex-col gap-1.5 text-right">
              {flightsCost > 0 && (
                <p className="text-white/50 text-xs">Flights: <span className="text-white/80 font-medium">{fmt(flightsCost)}</span></p>
              )}
              {hotelCost > 0 && (
                <p className="text-white/50 text-xs">Hotel: <span className="text-white/80 font-medium">{fmt(hotelCost)}</span></p>
              )}
              {activitiesCost > 0 && (
                <p className="text-white/50 text-xs">Activities: <span className="text-white/80 font-medium">{fmt(activitiesCost)}</span></p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Flights section */}
      {(itinerary.outboundFlight || itinerary.returnFlight) && (
        <section>
          <SectionHeader icon={<Plane size={16} className="text-blue-500" />} label="Flights" />
          <div className="space-y-4">
            {itinerary.outboundFlight && (
              <FlightCard flight={itinerary.outboundFlight} label="Outbound Flight" />
            )}
            {itinerary.returnFlight && (
              <FlightCard flight={itinerary.returnFlight} label="Return Flight" />
            )}
          </div>
        </section>
      )}

      {/* Hotel section */}
      {itinerary.hotel && (
        <section>
          <SectionHeader icon={<Building2 size={16} className="text-violet-500" />} label="Hotel" />
          <HotelCard hotel={itinerary.hotel} />
        </section>
      )}

      {/* Day-by-day */}
      {itinerary.days?.length > 0 && (
        <section>
          <SectionHeader icon={<Calendar size={16} className="text-indigo-500" />} label="Day-by-Day Itinerary" />
          <div className="space-y-4">
            {itinerary.days.map((day, idx) => (
              <DayCard key={day.date || idx} day={day} dayNumber={idx + 1} />
            ))}
          </div>
        </section>
      )}

      {/* Budget breakdown */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-50 to-slate-100 px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-500" />
            <h2 className="font-bold text-slate-800">Budget Breakdown</h2>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {flightsCost > 0 && (
              <BudgetRow
                icon={<Plane size={14} className="text-blue-500" />}
                label="Flights"
                amount={flightsCost}
                total={itinerary.totalCost}
                color="bg-blue-500"
              />
            )}
            {hotelCost > 0 && (
              <BudgetRow
                icon={<Building2 size={14} className="text-violet-500" />}
                label="Hotel"
                amount={hotelCost}
                total={itinerary.totalCost}
                color="bg-violet-500"
              />
            )}
            {activitiesCost > 0 && (
              <BudgetRow
                icon={<MapPin size={14} className="text-emerald-500" />}
                label="Activities"
                amount={activitiesCost}
                total={itinerary.totalCost}
                color="bg-emerald-500"
              />
            )}
          </div>

          <div className="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-indigo-500" />
              <span className="font-bold text-slate-800">Total</span>
            </div>
            <span className="text-2xl font-extrabold text-indigo-600">
              {formatCurrency(itinerary.totalCost)}
            </span>
          </div>

          {/* Budget bar */}
          {brief && brief.budgetMax > 0 && (
            <div className="mt-5 bg-slate-50 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                <span className="font-medium">Budget range</span>
                <span className="font-mono">
                  {fmt(brief.budgetMin)} – {fmt(brief.budgetMax)}
                </span>
              </div>
              <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    itinerary.totalCost > brief.budgetMax
                      ? "bg-red-400"
                      : itinerary.totalCost > brief.budgetMin
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                  }`}
                  style={{
                    width: `${Math.min(100, (itinerary.totalCost / brief.budgetMax) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SectionHeader({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
        {icon}
      </div>
      <h2 className="text-base font-bold text-slate-800">{label}</h2>
      <div className="flex-1 h-px bg-slate-100 ml-2" />
    </div>
  );
}

function BudgetRow({
  icon,
  label,
  amount,
  total,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-slate-600">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{pct}%</span>
          <span className="font-semibold text-slate-800 text-sm min-w-[80px] text-right">
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              maximumFractionDigits: 0,
            }).format(amount)}
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
