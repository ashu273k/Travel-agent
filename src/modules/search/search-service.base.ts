import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../cache/redis.service";

export abstract class SearchServiceBase {
  protected readonly logger: Logger;

  constructor(
    protected readonly configService: ConfigService,
    protected readonly redisService: RedisService,
    loggerName: string,
  ) {
    this.logger = new Logger(loggerName);
  }

  protected async getOrSearch<T>(
    cacheKey: string,
    ttl: number,
    searchFn: () => Promise<T>,
  ): Promise<T> {
    return this.redisService.getOrSearch(cacheKey, ttl, searchFn);
  }
}
