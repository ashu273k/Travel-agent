import { describe, it, expect } from "vitest";
import { LlmService } from "../../src/modules/llm/llm.service";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";

describe("Constraint Extraction Eval", () => {
  const configService = new ConfigService();
  const llmService = new LlmService(configService);
  const briefsPath = path.join(__dirname, "../fixtures/sample-briefs.json");
  const briefs = JSON.parse(fs.readFileSync(briefsPath, "utf8"));

  it("should extract constraints from briefs", async () => {
    for (const item of briefs) {
      const response = await llmService.complete("intent-parser", [
        {
          role: "system",
          content:
            "You are an expert Travel Constraint Extractor. Return ONLY JSON.",
        },
        { role: "user", content: item.brief },
      ]);
      const result = JSON.parse(response);
      expect(result.origin).toBeDefined();
      expect(result.destination).toBeDefined();
      expect(result.departureDate).toBeDefined();
      expect(result.travellers).toBeGreaterThan(0);
      expect(result.budgetMax).toBeGreaterThan(0);
    }
  });
});
