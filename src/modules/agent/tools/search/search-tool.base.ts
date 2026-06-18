import { Logger } from "@nestjs/common";
import { z } from "zod";
import { ContextCompressorService } from "../context-compressor.service";

export interface SearchToolResult {
  result: string;
  savings: {
    beforeBytes: number;
    afterBytes: number;
    rtkUsed: boolean;
  };
}

export abstract class SearchToolBase<T extends z.ZodObject<any>> {
  protected readonly logger: Logger;

  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: T;

  constructor(
    protected readonly compressorService: ContextCompressorService,
    loggerName: string,
  ) {
    this.logger = new Logger(loggerName);
  }

  async execute(input: z.infer<T>): Promise<SearchToolResult> {
    this.logger.log(`Executing ${this.name}: ${JSON.stringify(input)}`);

    const rawResult = await this.performSearch(input);

    const compression = await this.compressorService.compressToolResult(
      this.name,
      rawResult,
    );

    return {
      result: compression.compressed,
      savings: {
        beforeBytes: compression.beforeBytes,
        afterBytes: compression.afterBytes,
        rtkUsed: compression.rtkUsed,
      },
    };
  }

  protected abstract performSearch(input: z.infer<T>): Promise<any>;
}
