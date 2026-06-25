"use client";

import type { DayPlan, Flight, Hotel, Activity } from "@/lib/types";
import {
  Plane,
  Building2,
  MapPin,
  Utensils,
  Car,
  Compass,
  Coffee,
  Clock,
  IndianRupee,
  ArrowRight,
  ExternalLink,
} from "lucide-react";

function mapsUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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

function isFlightItem(item: Flight | Hotel | Activity): item is Flight {
  return "flightNumber" in item;
}

function isHotelItem(item: Flight | Hotel | Activity): item is Hotel {
  return "checkIn" in item && !("flightNumber" in item);
}

function ActivityIcon({ type }: { type: Activity["type"] }) {
  switch (type) {
    case "restaurant": return <Utensils size={14} />;
    case "transport":  return <Car size={14} />;
    case "excursion":  return <Compass size={14} />;
    case "free_time":  return <Coffee size={14} />;
    default:           return <MapPin size={14} />;
  }
}

function activityStyle(type: Activity["type"]) {
  switch (type) {
    case "restaurant": return { bg: "bg-orange-50 border-orange-100", icon: "bg-orange-100 text-orange-600", text: "text-orange-700", badge: "bg-orange-100 text-orange-600" };
    case "transport":  return { bg: "bg-slate-50 border-slate-200",   icon: "bg-slate-100 text-slate-600",  text: "text-slate-700",  badge: "bg-slate-100 text-slate-500" };
    case "excursion":  return { bg: "bg-violet-50 border-violet-100", icon: "bg-violet-100 text-violet-600", text: "text-violet-700", badge: "bg-violet-100 text-violet-600" };
    case "free_time":  return { bg: "bg-teal-50 border-teal-100",     icon: "bg-teal-100 text-teal-600",    text: "text-teal-700",   badge: "bg-teal-100 text-teal-600" };
    default:           return { bg: "bg-emerald-50 border-emerald-100", icon: "bg-emerald-100 text-emerald-600", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-600" };
  }
}

function FlightItem({ flight }: { flight: Flight }) {
  return (
    <div className="flex items-center gap-3 py-3 px-4 bg-blue-50 rounded-xl border border-blue-100">
      <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
        <Plane className="text-white" size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-slate-800 text-sm">{flight.airline}</span>
          <span className="text-slate-400 text-xs font-mono">{flight.flightNumber}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs font-bold text-slate-700">{formatTime(flight.departTime)}</span>
          <span className="text-slate-400 text-xs font-medium">{flight.origin}</span>
          <ArrowRight size={11} className="text-slate-300" />
          <span className="text-xs font-bold text-slate-700">{formatTime(flight.arriveTime)}</span>
          <span className="text-slate-400 text-xs font-medium">{flight.destination}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-xs text-slate-400">
          {flight.stops === 0 ? "Non-stop" : `${flight.stops}S`}
        </span>
        {flight.totalPrice > 0 && (
          <span className="text-xs font-bold text-blue-600 flex items-center gap-0.5">
            <IndianRupee size={10} />
            {(flight.totalPrice / 1000).toFixed(0)}K
          </span>
        )}
      </div>
    </div>
  );
}

function HotelItem({ hotel }: { hotel: Hotel }) {
  return (
    <div className="flex items-center gap-3 py-3 px-4 bg-violet-50 rounded-xl border border-violet-100">
      <div className="w-8 h-8 rounded-lg bg-violet-500 flex items-center justify-center flex-shrink-0">
        <Building2 className="text-white" size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-semibold text-slate-800 text-sm truncate">{hotel.name}</p>
          {hotel.address && (
            <a
              href={mapsUrl(hotel.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:text-violet-600 flex-shrink-0"
              title="View on Google Maps"
            >
              <ExternalLink size={11} />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-yellow-400 text-xs">{"★".repeat(hotel.stars)}</span>
          <span className="text-xs text-slate-400">Check-in {hotel.checkInTime}</span>
        </div>
      </div>
      {hotel.pricePerNight > 0 && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <IndianRupee size={10} className="text-violet-600" />
          <span className="text-xs font-bold text-violet-700">
            {(hotel.pricePerNight / 1000).toFixed(0)}K/night
          </span>
        </div>
      )}
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const s = activityStyle(activity.type);
  return (
    <div className={`flex items-start gap-3 py-3 px-4 rounded-xl border ${s.bg}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${s.icon}`}>
        <ActivityIcon type={activity.type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${s.text}`}>{activity.name}</p>
        {activity.location && (
          <a
            href={mapsUrl(activity.location)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 hover:text-slate-700 mt-0.5 flex items-center gap-1 truncate group"
            title="View on Google Maps"
          >
            <MapPin size={10} className="flex-shrink-0" />
            <span className="truncate">{activity.location}</span>
            <ExternalLink size={9} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {activity.startTime && (
            <span className="flex items-center gap-0.5 text-xs text-slate-400">
              <Clock size={10} />
              {formatTime(activity.startTime)}
              {activity.endTime && ` – ${formatTime(activity.endTime)}`}
            </span>
          )}
          {activity.durationMins > 0 && (
            <span className="text-xs text-slate-400">{formatDuration(activity.durationMins)}</span>
          )}
          {activity.cost > 0 && (
            <span className={`flex items-center gap-0.5 text-xs font-semibold ${s.text}`}>
              <IndianRupee size={10} />
              {activity.cost.toLocaleString("en-IN")}
            </span>
          )}
        </div>
        {activity.notes && (
          <p className="text-xs text-slate-400 mt-1 italic line-clamp-1">{activity.notes}</p>
        )}
        {activity.bookingRequired && (
          <span className="inline-block mt-1.5 text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
            Booking required
          </span>
        )}
      </div>
    </div>
  );
}

function formatDayHeader(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return dateStr;
  }
}

export default function DayCard({ day, dayNumber }: { day: DayPlan; dayNumber: number }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-extrabold text-sm">{dayNumber}</span>
        </div>
        <div>
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Day {dayNumber}</p>
          <p className="font-bold text-slate-800 text-sm">{formatDayHeader(day.date)}</p>
        </div>
        <div className="ml-auto text-xs text-slate-400 font-medium">
          {day.items.length} {day.items.length === 1 ? "item" : "items"}
        </div>
      </div>

      {/* Items */}
      <div className="p-4 space-y-2.5">
        {day.items.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-6">Free day — explore at your own pace</p>
        ) : (
          day.items.map((item, idx) => {
            if (isFlightItem(item)) return <FlightItem key={item.id || idx} flight={item} />;
            if (isHotelItem(item)) return <HotelItem key={item.id || idx} hotel={item} />;
            return <ActivityItem key={(item as Activity).id || idx} activity={item as Activity} />;
          })
        )}
      </div>
    </div>
  );
}
