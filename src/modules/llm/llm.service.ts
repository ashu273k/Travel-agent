import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

export interface ModelConfig {
  provider: "openai" | "google" | "openrouter" | "groq";
  model: string;
  temperature: number;
  maxTokens?: number;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private defaultProvider: string;
  private openAiKey?: string;
  private geminiKey?: string;
  private openRouterKey?: string;
  private useMock = false;

  private groqKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultProvider = this.configService.get<string>("LLM_DEFAULT_PROVIDER", "groq");
    this.openAiKey = this.configService.get<string>("OPENAI_API_KEY");
    this.geminiKey = this.configService.get<string>("GEMINI_API_KEY");
    this.openRouterKey = this.configService.get<string>("OPENROUTER_API_KEY");
    this.groqKey = this.configService.get<string>("GROQ_API_KEY");
    // Strip surrounding quotes/whitespace — common artifact when editing .env files
    if (this.groqKey) {
      this.groqKey = this.groqKey.replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
      if (this.groqKey && this.groqKey.length > 8) {
        this.logger.log(`Groq key: ${this.groqKey.slice(0, 8)}...${this.groqKey.slice(-4)} (${this.groqKey.length} chars)`);
      }
    }

    const hasKeys = (this.openAiKey && this.openAiKey !== "sk-...") ||
                    (this.geminiKey && this.geminiKey !== "AIza...") ||
                    (this.openRouterKey && this.openRouterKey !== "sk-or-...") ||
                    (this.groqKey && this.groqKey !== "gsk_..." && this.groqKey.startsWith("gsk_"));

    if (!hasKeys) {
      this.logger.warn("No LLM API keys detected. Operating in OFFLINE MOCK MODE.");
      this.useMock = true;
    }
  }

  private getModelConfigForNode(nodeName: string): ModelConfig {
    const useGroq = this.groqKey && this.groqKey !== "gsk_...";
    switch (nodeName) {
      case "intent-parser":
        if (useGroq) return { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1 };
        return { provider: this.geminiKey ? "google" : "openai", model: this.geminiKey ? "gemini-2.0-flash" : "gpt-4o-mini", temperature: 0.1 };
      case "itinerary-assembler":
        if (useGroq) return { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.4, maxTokens: 4096 };
        return { provider: "openai", model: "gpt-4o", temperature: 0.4, maxTokens: 4096 };
      case "conflict-resolver":
        if (useGroq) return { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 2048 };
        return { provider: "openai", model: "gpt-4o-mini", temperature: 0.1, maxTokens: 2048 };
      case "change-manager":
        if (useGroq) return { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.3, maxTokens: 4096 };
        return { provider: this.openRouterKey ? "openrouter" : "openai", model: this.openRouterKey ? "anthropic/claude-3-5-sonnet" : "gpt-4o", temperature: 0.3, maxTokens: 4096 };
      default:
        if (useGroq) return { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.5 };
        return { provider: this.geminiKey ? "google" : "openai", model: this.geminiKey ? "gemini-2.0-flash" : "gpt-4o-mini", temperature: 0.5 };
    }
  }

  private getChatClient(config: ModelConfig): BaseChatModel {
    if (config.provider === "openai") {
      return new ChatOpenAI({ openAIApiKey: this.openAiKey, modelName: config.model, temperature: config.temperature, maxTokens: config.maxTokens });
    } else if (config.provider === "google") {
      return new ChatGoogleGenerativeAI({ apiKey: this.geminiKey, model: config.model, temperature: config.temperature, maxOutputTokens: config.maxTokens });
    } else if (config.provider === "openrouter") {
      return new ChatOpenAI({
        openAIApiKey: this.openRouterKey,
        modelName: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        configuration: { baseURL: "https://openrouter.ai/api/v1", defaultHeaders: { "HTTP-Referer": "https://github.com/ashu273k/Travel-agent", "X-Title": "Agentic Travel Planner" } },
      });
    } else if (config.provider === "groq") {
      return new ChatOpenAI({
        openAIApiKey: this.groqKey,
        modelName: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        configuration: { baseURL: "https://api.groq.com/openai/v1" },
      });
    }
    return new ChatOpenAI({ openAIApiKey: this.openAiKey, modelName: "gpt-4o-mini" });
  }

  private mapMessages(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): BaseMessage[] {
    return messages.map((m) => {
      if (m.role === "system") return new SystemMessage(m.content);
      if (m.role === "assistant") return new AIMessage(m.content);
      return new HumanMessage(m.content);
    });
  }

  private extractJson(text: string): string {
    // Strip markdown code fences if present
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced) return fenced[1].trim();
    // Find first { or [ and return from there
    const start = text.search(/[{[]/);
    if (start !== -1) return text.slice(start);
    return text;
  }

  private async callGroqDirect(
    model: string,
    messages: Array<{ role: string; content: string }>,
    temperature: number,
    maxTokens = 4096,
    jsonMode = false,
  ): Promise<string> {
    const body: any = { model, messages, temperature, max_tokens: maxTokens };
    if (jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(`Groq ${res.status}: ${err?.error?.message ?? res.statusText}`);
    }

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  }

  async complete(nodeName: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, schema?: z.ZodType<any>): Promise<string> {
    const config = this.getModelConfigForNode(nodeName);

    // Try Groq via direct fetch first (bypasses LangChain OpenAI auth quirks)
    if (!this.useMock && config.provider === "groq" && this.groqKey) {
      try {
        const needsJson = ["assemble_itinerary", "itinerary-assembler", "intent-parser", "detect_conflicts", "resolve_conflict", "conflict-resolver"].includes(nodeName);
        const raw = await this.callGroqDirect(config.model, messages, config.temperature, config.maxTokens, needsJson);
        this.logger.log(`Groq [${nodeName}] OK — model: ${config.model}`);
        return needsJson ? this.extractJson(raw) : raw;
      } catch (err: any) {
        this.logger.warn(`Groq call failed for [${nodeName}]: ${err.message} — falling back to mock`);
        return this.generateMockResponse(nodeName, messages, schema);
      }
    }

    if (this.useMock) return this.generateMockResponse(nodeName, messages, schema);

    // LangChain path for OpenAI / Gemini / OpenRouter
    try {
      const client = this.getChatClient(config);
      const lcMessages = this.mapMessages(messages);
      if (schema) {
        const structuredClient = client.withStructuredOutput(schema);
        const response = await structuredClient.invoke(lcMessages);
        return JSON.stringify(response);
      }
      const response = await client.invoke(lcMessages);
      return typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    } catch (error: any) {
      this.logger.error(`LLM Call failed for ${nodeName}: ${error?.message}`);
      return this.generateMockResponse(nodeName, messages, schema);
    }
  }

  async *stream(nodeName: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): AsyncGenerator<string, void, unknown> {
    const config = this.getModelConfigForNode(nodeName);
    if (this.useMock) {
      const mock = await this.generateMockResponse(nodeName, messages);
      for (const chunk of mock.split(" ")) {
        yield chunk + " ";
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }

    try {
      const client = this.getChatClient(config);
      const stream = await client.stream(this.mapMessages(messages));
      for await (const chunk of stream) {
        yield typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
      }
    } catch (error) {
      this.logger.error(`LLM Stream failed for ${nodeName}.`, error);
      yield await this.generateMockResponse(nodeName, messages);
    }
  }

  // ── Mock helpers ──────────────────────────────────────────────────────────────

  private readonly CITY_MAP: Record<string, { iata: string; name: string }> = {
    bangalore: { iata: "BLR", name: "Bangalore, India" },
    bengaluru: { iata: "BLR", name: "Bangalore, India" },
    goa: { iata: "GOI", name: "Goa, India" },
    mumbai: { iata: "BOM", name: "Mumbai, India" },
    bombay: { iata: "BOM", name: "Mumbai, India" },
    delhi: { iata: "DEL", name: "Delhi, India" },
    "new delhi": { iata: "DEL", name: "Delhi, India" },
    chennai: { iata: "MAA", name: "Chennai, India" },
    kolkata: { iata: "CCU", name: "Kolkata, India" },
    hyderabad: { iata: "HYD", name: "Hyderabad, India" },
    pune: { iata: "PNQ", name: "Pune, India" },
    jaipur: { iata: "JAI", name: "Jaipur, India" },
    kochi: { iata: "COK", name: "Kochi, India" },
    manali: { iata: "KUU", name: "Manali, India" },
    shimla: { iata: "SLV", name: "Shimla, India" },
    kashmir: { iata: "SXR", name: "Srinagar, Kashmir" },
    srinagar: { iata: "SXR", name: "Srinagar, Kashmir" },
    leh: { iata: "IXL", name: "Leh, Ladakh" },
    ladakh: { iata: "IXL", name: "Leh, Ladakh" },
    varanasi: { iata: "VNS", name: "Varanasi, India" },
    agra: { iata: "AGR", name: "Agra, India" },
    udaipur: { iata: "UDR", name: "Udaipur, India" },
    amritsar: { iata: "ATQ", name: "Amritsar, India" },
    calcutta: { iata: "CCU", name: "Kolkata, India" },
    paris: { iata: "CDG", name: "Paris, France" },
    london: { iata: "LHR", name: "London, UK" },
    dubai: { iata: "DXB", name: "Dubai, UAE" },
    singapore: { iata: "SIN", name: "Singapore" },
    bangkok: { iata: "BKK", name: "Bangkok, Thailand" },
    bali: { iata: "DPS", name: "Bali, Indonesia" },
    tokyo: { iata: "NRT", name: "Tokyo, Japan" },
    rome: { iata: "FCO", name: "Rome, Italy" },
    amsterdam: { iata: "AMS", name: "Amsterdam, Netherlands" },
  };

  private parseBriefFromText(text: string): object {
    const lower = text.toLowerCase();
    let origin = { iata: "BOM", name: "Mumbai, India" };
    let destination = { iata: "GOI", name: "Goa, India" };

    // match "from X to Y"
    const fromTo = lower.match(/from\s+([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s+for|\s+in|\s+on|\s*,|\s*\d|$)/);
    if (fromTo) {
      for (const [city, info] of Object.entries(this.CITY_MAP)) {
        if (fromTo[1].includes(city)) origin = info;
        if (fromTo[2].includes(city)) destination = info;
      }
    } else {
      const found: Array<{ iata: string; name: string }> = [];
      for (const [city, info] of Object.entries(this.CITY_MAP)) {
        if (lower.includes(city)) found.push(info);
      }
      if (found.length >= 2) { origin = found[0]; destination = found[1]; }
      else if (found.length === 1) { destination = found[0]; }
    }

    const travellersMatch = lower.match(/(\d+)\s*(?:people|persons?|adults?|travell?ers?|pax)/);
    const travellers = travellersMatch ? parseInt(travellersMatch[1]) : 2;

    const months: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
    let month = (new Date().getMonth() + 2) % 12 || 12;
    let year = new Date().getFullYear();
    for (const [name, num] of Object.entries(months)) { if (lower.includes(name)) { month = num; break; } }
    const yearMatch = text.match(/20\d\d/);
    if (yearMatch) year = parseInt(yearMatch[0]);
    if (month <= new Date().getMonth() + 1 && year === new Date().getFullYear()) year++;

    const daysMatch = lower.match(/(\d+)\s*(?:days?|nights?)/);
    const days = daysMatch ? Math.max(parseInt(daysMatch[1]), 2) : 5;
    const departureDate = `${year}-${String(month).padStart(2, "0")}-15`;
    const ret = new Date(new Date(departureDate).getTime() + days * 86400000);
    const returnDate = ret.toISOString().split("T")[0];

    const budgetMatch = text.match(/(\d[\d,]+)\s*(?:to|-)\s*(\d[\d,]+)/);
    const parseAmt = (s: string) => { const n = parseFloat(s.replace(/,/g, "")); if (lower.includes("lakh")) return n * 100000; if (lower.includes("k")) return n * 1000; return n; };
    const budgetMin = budgetMatch ? Math.round(parseAmt(budgetMatch[1])) : 50000;
    const budgetMax = budgetMatch ? Math.round(parseAmt(budgetMatch[2])) : 100000;

    const interests: string[] = [];
    if (lower.match(/beach|sea|ocean|water/)) interests.push("beach");
    if (lower.match(/food|cuisine|eat|restaurant/)) interests.push("food");
    if (lower.match(/history|heritage|museum|monument/)) interests.push("history");
    if (lower.match(/adventure|trek|hik|sport/)) interests.push("adventure");
    if (lower.match(/nature|wildlife|forest|mountain/)) interests.push("nature");
    if (lower.match(/shop|market|mall/)) interests.push("shopping");
    if (lower.match(/art|culture|architect/)) interests.push("art");
    if (interests.length === 0) interests.push("sightseeing");

    return { origin: origin.iata, destination: destination.name, departureDate, returnDate, travellers, budgetMin, budgetMax, currency: "INR", accommodationPrefs: ["hotel"], specialRequirements: [], interests };
  }

  private buildMockItinerary(brief: any): object {
    const dest = (brief.destination || "Goa, India").toLowerCase();
    const origin = brief.origin || "BOM";
    const dep = brief.departureDate || "2026-08-15";
    const ret = brief.returnDate || "2026-08-20";
    const n = brief.travellers || 2;
    const nights = Math.max(Math.round((new Date(ret).getTime() - new Date(dep).getTime()) / 86400000), 1);

    // Realistic prices by route category (INR, per person one-way)
    type RouteCategory = "domestic" | "seasia" | "gulf" | "europe" | "fareast";
    const getCategory = (d: string): RouteCategory => {
      if (d.match(/goa|delhi|mumbai|bangalore|chennai|hyderabad|kolkata|pune|jaipur|manali|shimla|kochi/)) return "domestic";
      if (d.match(/bangkok|bali|singapore|phuket|kuala lumpur|vietnam|cambodia/)) return "seasia";
      if (d.match(/dubai|abu dhabi|doha|riyadh|muscat|bahrain/)) return "gulf";
      if (d.match(/paris|london|rome|barcelona|amsterdam|berlin|madrid|prague|zurich/)) return "europe";
      return "fareast"; // tokyo, sydney, new york, etc.
    };

    const PRICING: Record<RouteCategory, { flightPP: number; hotelPPN: number; duration: number; actCost: number }> = {
      domestic: { flightPP: 4500,  hotelPPN: 5500,  duration: 90,  actCost: 1200 },
      seasia:   { flightPP: 18000, hotelPPN: 8000,  duration: 240, actCost: 2000 },
      gulf:     { flightPP: 17000, hotelPPN: 12000, duration: 210, actCost: 3000 },
      europe:   { flightPP: 55000, hotelPPN: 10000, duration: 480, actCost: 3500 },
      fareast:  { flightPP: 40000, hotelPPN: 11000, duration: 420, actCost: 3000 },
    };

    const cat = getCategory(dest);
    const { flightPP, hotelPPN, duration, actCost } = PRICING[cat];

    const destinations: Record<string, { code: string; hotel: string; airline: string; airlineCode: string; fnBase: string; stars: number; acts: Array<{ name: string; type: string; loc: string; notes: string }> }> = {
      goa:       { code: "GOI", hotel: "The Leela Goa", airline: "IndiGo", airlineCode: "6E", fnBase: "456", stars: 4, acts: [{ name: "Baga Beach & Seafood Lunch", type: "restaurant", loc: "Baga Beach, Goa", notes: "Fresh seafood at beach shacks" }, { name: "Old Goa Heritage Walk", type: "attraction", loc: "Old Goa", notes: "Basilica of Bom Jesus, Se Cathedral" }, { name: "Water Sports at Calangute", type: "excursion", loc: "Calangute Beach", notes: "Parasailing, jet-ski, banana boat" }, { name: "Anjuna Flea Market", type: "attraction", loc: "Anjuna, Goa", notes: "Local handicrafts and art" }, { name: "Sunset Cruise on Mandovi", type: "excursion", loc: "Panaji Jetty", notes: "Live music and cultural show" }] },
      manali:    { code: "KUU", hotel: "Snow Valley Resorts", airline: "Air India", airlineCode: "AI", fnBase: "234", stars: 4, acts: [{ name: "Rohtang Pass Day Trip", type: "excursion", loc: "Rohtang Pass", notes: "Snow activities, permit required" }, { name: "Hadimba Devi Temple", type: "attraction", loc: "Old Manali", notes: "Ancient wooden temple in deodar forest" }, { name: "Beas River Rafting", type: "excursion", loc: "Pirdi, Manali", notes: "Grade III rapids, thrilling ride" }, { name: "Old Manali Café Crawl", type: "restaurant", loc: "Old Manali", notes: "Israeli food, Tibetan momos, local thali" }] },
      dubai:     { code: "DXB", hotel: "JW Marriott Marquis Dubai", airline: "Emirates", airlineCode: "EK", fnBase: "502", stars: 5, acts: [{ name: "Burj Khalifa — At The Top", type: "attraction", loc: "Downtown Dubai", notes: "124th & 125th floor observatory" }, { name: "Desert Safari with BBQ Dinner", type: "excursion", loc: "Dubai Desert Conservation Reserve", notes: "Dune bashing, camel ride, henna, belly dance" }, { name: "Dubai Frame & Museum of the Future", type: "attraction", loc: "Zabeel, Dubai", notes: "Iconic landmarks of old and new Dubai" }, { name: "Gold & Spice Souk Walk", type: "attraction", loc: "Deira, Dubai", notes: "Traditional market experience" }] },
      bangkok:   { code: "BKK", hotel: "Centara Grand at CentralWorld", airline: "Thai Airways", airlineCode: "TG", fnBase: "315", stars: 5, acts: [{ name: "Grand Palace & Wat Phrakaew", type: "attraction", loc: "Ko Ratanakosin, Bangkok", notes: "Royal palace complex, dress code required" }, { name: "Floating Market Tour", type: "excursion", loc: "Damnoen Saduak", notes: "Traditional market on waterways, boat ride" }, { name: "Yaowarat Street Food Night Tour", type: "restaurant", loc: "Chinatown, Bangkok", notes: "Best street food in Bangkok" }, { name: "Chatuchak Weekend Market", type: "attraction", loc: "Chatuchak, Bangkok", notes: "Over 15,000 stalls of everything" }] },
      paris:     { code: "CDG", hotel: "Hôtel Le Marais — Paris", airline: "Air France", airlineCode: "AF", fnBase: "225", stars: 4, acts: [{ name: "Eiffel Tower — Summit Visit", type: "attraction", loc: "Champ de Mars, 7th Arr.", notes: "Book summit tickets 60 days in advance" }, { name: "Louvre Museum", type: "attraction", loc: "Rue de Rivoli, 1st Arr.", notes: "2–4 hours recommended, book timed entry" }, { name: "Seine River Evening Cruise", type: "excursion", loc: "Port de la Bourdonnais", notes: "1-hour cruise past all major landmarks" }, { name: "Lunch at Café de Flore", type: "restaurant", loc: "Boulevard Saint-Germain", notes: "Historic literary café, classic French menu" }] },
      singapore: { code: "SIN", hotel: "Marina Bay Sands", airline: "Singapore Airlines", airlineCode: "SQ", fnBase: "423", stars: 5, acts: [{ name: "Gardens by the Bay Night Show", type: "attraction", loc: "Marina Bay", notes: "Cloud Forest, Flower Dome, Supertrees" }, { name: "Universal Studios Singapore", type: "excursion", loc: "Sentosa Island", notes: "Full day, book tickets in advance" }, { name: "Maxwell Hawker Centre Food Tour", type: "restaurant", loc: "Maxwell Road", notes: "Hainanese chicken rice, char kway teow" }, { name: "Little India & Chinatown Walk", type: "attraction", loc: "Central Singapore", notes: "Colourful neighbourhoods, free entry" }] },
      london:    { code: "LHR", hotel: "The Strand Palace Hotel", airline: "British Airways", airlineCode: "BA", fnBase: "118", stars: 4, acts: [{ name: "Tower of London & Tower Bridge", type: "attraction", loc: "Tower Hill, London", notes: "Crown Jewels, Beefeaters, medieval history" }, { name: "British Museum", type: "attraction", loc: "Bloomsbury, London", notes: "Free entry, Rosetta Stone, Egyptian mummies" }, { name: "West End Show", type: "excursion", loc: "West End, London", notes: "Book Les Misérables or The Lion King" }, { name: "Borough Market Food Tour", type: "restaurant", loc: "Southwark, London", notes: "London's oldest food market" }] },
    };

    let destInfo = destinations["goa"];
    for (const [key, info] of Object.entries(destinations)) {
      if (dest.includes(key)) { destInfo = info; break; }
    }

    // If no match found, build a generic entry
    if (!Object.keys(destinations).some(k => dest.includes(k))) {
      const destName = (brief.destination || "destination").split(",")[0].trim();
      destInfo = { code: "---", hotel: `${destName} Grand Hotel`, airline: "Air India", airlineCode: "AI", fnBase: "201", stars: 4, acts: [
        { name: `${destName} City Tour`, type: "attraction", loc: destName, notes: "Major landmarks and sightseeing" },
        { name: "Local Cuisine Experience", type: "restaurant", loc: destName, notes: "Authentic local food and culture" },
        { name: "Day Excursion", type: "excursion", loc: `${destName} surroundings`, notes: "Half-day guided tour" },
      ]};
    }

    const arriveHour = cat === "domestic" ? "08:30" : cat === "europe" ? "09:00" : "10:30";
    const outF = { id: "f1", airline: destInfo.airline, flightNumber: `${destInfo.airlineCode}${destInfo.fnBase}`, origin, destination: destInfo.code, departTime: `${dep}T06:00:00`, arriveTime: `${dep}T${arriveHour}:00`, durationMins: duration, stops: cat === "domestic" ? 0 : cat === "europe" ? 1 : 0, pricePerPerson: flightPP, totalPrice: flightPP * n, bookingRef: `${destInfo.airlineCode}-OUT-001`, status: "scheduled" as const };
    const retF = { id: "f2", airline: destInfo.airline, flightNumber: `${destInfo.airlineCode}${parseInt(destInfo.fnBase) + 1}`, origin: destInfo.code, destination: origin, departTime: `${ret}T14:00:00`, arriveTime: `${ret}T${cat === "domestic" ? "16:30" : cat === "europe" ? "22:00" : "19:00"}:00`, durationMins: duration, stops: outF.stops, pricePerPerson: flightPP, totalPrice: flightPP * n, bookingRef: `${destInfo.airlineCode}-RET-002`, status: "scheduled" as const };
    const hotel = { id: "h1", name: destInfo.hotel, address: brief.destination, stars: destInfo.stars, checkIn: dep, checkOut: ret, checkInTime: "14:00", checkOutTime: "11:00", pricePerNight: hotelPPN, totalPrice: hotelPPN * nights, amenities: ["Free WiFi", "Breakfast Included", "Swimming Pool", "24h Reception"], bookingRef: `HTL-${Date.now()}` };

    const days: any[] = [];
    let cur = new Date(dep);
    for (let i = 0; i <= nights; i++) {
      const ds = cur.toISOString().split("T")[0];
      const items: any[] = [];
      if (i === 0) { items.push(outF); items.push(hotel); }
      if (i > 0 && i < nights) {
        const a = destInfo.acts[(i - 1) % destInfo.acts.length];
        items.push({ id: `a${i}`, name: a.name, type: a.type, date: ds, startTime: `${ds}T10:00:00`, endTime: `${ds}T13:00:00`, durationMins: 180, cost: actCost * n, location: a.loc, notes: a.notes, bookingRequired: a.type === "excursion" });
      }
      if (i === nights) items.push(retF);
      days.push({ date: ds, items });
      cur = new Date(cur.getTime() + 86400000);
    }

    const actTotal = Math.min(nights - 1, destInfo.acts.length) * actCost * n;
    const totalCost = outF.totalPrice + retF.totalPrice + hotel.totalPrice + actTotal;

    return { id: `mock-${Date.now()}`, brief, outboundFlight: outF, returnFlight: retF, hotel, activities: days.filter(d => d.items.some((x: any) => !x.airline && !x.checkIn)).flatMap((d: any) => d.items.filter((x: any) => !x.airline && !x.checkIn)), days, totalCost, createdAt: new Date().toISOString(), status: "ASSEMBLING" };
  }

  private async generateMockResponse(nodeName: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, schema?: z.ZodType<any>): Promise<string> {
    const userMsg = messages.find((m) => m.role === "user")?.content || "";
    switch (nodeName) {
      case "intent-parser":
        return JSON.stringify(this.parseBriefFromText(userMsg));

      case "itinerary-assembler":
      case "assemble_itinerary": {
        // Extract the brief from the user message (format: "Brief: {...}\nFlights: ...")
        let brief: any = {};
        try {
          const briefMatch = userMsg.match(/Brief:\s*(\{.*?\})(?:\n|$)/s);
          if (briefMatch) brief = JSON.parse(briefMatch[1]);
        } catch {}
        return JSON.stringify(this.buildMockItinerary(brief));
      }

      case "conflict-resolver":
      case "resolve_conflict":
        return JSON.stringify({ conflictId: "c1", action: "adjust_time", explanation: "Adjusted hotel check-in time to accommodate flight arrival.", updatedSegmentIds: [] });

      case "detect_conflicts":
        return JSON.stringify([]);

      case "handle_flight_change":
      case "propagate_downstream":
      case "patch_segment":
        return JSON.stringify({ success: true, affectedSegmentIds: [], explanation: "Change processed successfully." });

      default:
        return JSON.stringify({ success: true, message: "Operation completed." });
    }
  }
}
