import { Module, Global } from "@nestjs/common";
import { RedisService } from "./redis.service";
import { QueueService } from "./queue.service";

@Global()
@Module({
  providers: [RedisService, QueueService],
  exports: [RedisService, QueueService],
})
export class CacheModule {}
