import { Logger } from "@nestjs/common";
import { z } from "zod";
import { LlmService } from "../../llm/llm.service";

export abstract class LlmToolBase<T extends z.ZodObject<any>, R> {
  protected readonly logger: Logger;

  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: T;

  constructor(
    protected readonly llmService: LlmService,
    loggerName: string,
  ) {
    this.logger = new Logger(loggerName);
  }

  async execute(input: z.infer<T>): Promise<R> {
    this.logger.log(`Executing ${this.name} via LLM...`);

    const systemPrompt = this.getSystemPrompt(input);
    const userPrompt = this.getUserPrompt(input);

    const response = await this.llmService.complete(this.name, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    try {
      return this.parseResponse(response, input);
    } catch (err) {
      this.logger.error(
        `Failed to parse LLM response for ${this.name}: ${(err as any).message}`,
      );
      return this.getFallbackResponse(response, input);
    }
  }

  protected abstract getSystemPrompt(input: z.infer<T>): string;
  protected abstract getUserPrompt(input: z.infer<T>): string;

  protected parseResponse(response: string, input: z.infer<T>): R {
    return JSON.parse(response) as R;
  }

  protected abstract getFallbackResponse(
    response: string,
    input: z.infer<T>,
  ): R;
}
