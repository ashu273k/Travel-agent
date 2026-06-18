import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

export interface ModelConfig {
  provider: "openai" | "google" | "openrouter";
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

  constructor(private readonly configService: ConfigService) {
    this.defaultProvider = this.configService.get<string>("LLM_DEFAULT_PROVIDER", "openai");
    this.openAiKey = this.configService.get<string>("OPENAI_API_KEY");
    this.geminiKey = this.configService.get<string>("GEMINI_API_KEY");
    this.openRouterKey = this.configService.get<string>("OPENROUTER_API_KEY");

    const hasKeys = (this.openAiKey && this.openAiKey !== "sk-...") ||
                    (this.geminiKey && this.geminiKey !== "AIza...") ||
                    (this.openRouterKey && this.openRouterKey !== "sk-or-...");

    if (!hasKeys) {
      this.logger.warn("No LLM API keys detected. Operating in OFFLINE MOCK MODE.");
      this.useMock = true;
    }
  }

  private getModelConfigForNode(nodeName: string): ModelConfig {
    switch (nodeName) {
      case "intent-parser":
        return { provider: this.geminiKey ? "google" : "openai", model: this.geminiKey ? "gemini-2.0-flash" : "gpt-4o-mini", temperature: 0.1 };
      case "itinerary-assembler":
        return { provider: "openai", model: "gpt-4o", temperature: 0.4, maxTokens: 4096 };
      case "conflict-resolver":
        return { provider: "openai", model: "gpt-4o-mini", temperature: 0.1, maxTokens: 2048 };
      case "change-manager":
        return { provider: this.openRouterKey ? "openrouter" : "openai", model: this.openRouterKey ? "anthropic/claude-3-5-sonnet" : "gpt-4o", temperature: 0.3, maxTokens: 4096 };
      default:
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

  async complete(nodeName: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, schema?: z.ZodType<any>): Promise<string> {
    const config = this.getModelConfigForNode(nodeName);
    if (this.useMock) return this.generateMockResponse(nodeName, messages, schema);

    try {
      const client = this.getChatClient(config);
      const lcMessages = this.mapMessages(messages);
      if (schema) {
        const structuredClient = client.withStructuredOutput(schema);
        const response = await structuredClient.invoke(lcMessages);
        return JSON.stringify(response);
      } else {
        const response = await client.invoke(lcMessages);
        return typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      }
    } catch (error) {
      this.logger.error(`LLM Call failed for ${nodeName}.`, error);
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

  private async generateMockResponse(nodeName: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, schema?: z.ZodType<any>): Promise<string> {
    const userPrompt = messages.find((m) => m.role === "user")?.content || "";
    switch (nodeName) {
      case "intent-parser":
        return JSON.stringify({ origin: "BOM", destination: "Paris, France", departureDate: "2026-08-15", returnDate: "2026-08-20", travellers: 2, budgetMin: 150000, budgetMax: 200000, currency: "INR", accommodationPrefs: ["hotel", "4-star"], specialRequirements: [], interests: ["food", "history"] });
      case "itinerary-assembler":
        return JSON.stringify({ id: "mock-itinerary-id", totalCost: 185000, days: [{ date: "2026-08-15", items: [] }] });
      case "conflict-resolver":
        return JSON.stringify({ conflictId: "c1", action: "adjust_time", explanation: "Adjusted.", updatedSegmentIds: [] });
      default:
        return "Mock reply.";
    }
  }
}
