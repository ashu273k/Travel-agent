import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: IORedis | null = null;
  private useFallback = false;

  private registeredHandlers = new Map<string, (data: any) => Promise<any>>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>("REDIS_HOST", "localhost");
    const port = this.configService.get<number>("REDIS_PORT", 6379);

    try {
      this.connection = new IORedis({
        host,
        port,
        maxRetriesPerRequest: null, // BullMQ requires this set to null
      });

      this.connection.on("error", (err) => {
        this.logger.error("Redis Queue connection error:", err.message);
        this.useFallback = true;
      });

      // Initialize the BullMQ queue
      this.queue = new Queue("agent-tasks", {
        connection: { host, port },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        },
      });

      this.worker = new Worker(
        "agent-tasks",
        async (job: Job) => {
          this.logger.log(
            `Worker processing job [${job.id}] of type [${job.name}]`,
          );
          const handler = this.registeredHandlers.get(job.name);
          if (handler) {
            return await handler(job.data);
          }
          this.logger.warn(`No handler registered for job type: ${job.name}`);
        },
        { connection: { host, port } },
      );

      this.worker.on("failed", (job, err) => {
        this.logger.error(`Job [${job?.id}] failed:`, err.message);
      });

      this.worker.on("completed", (job) => {
        this.logger.log(`Job [${job.id}] completed successfully.`);
      });

      this.logger.log("BullMQ Queue and Worker successfully initialized.");
    } catch (error) {
      this.logger.error(
        "Failed to initialize BullMQ. Activating synchronous in-memory queue fallback.",
        error,
      );
      this.useFallback = true;
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.queue) {
      await this.queue.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
    this.logger.log("BullMQ connections shut down.");
  }

  /**
   * Registers a job runner function for a specific job name.
   */
  registerJobHandler(name: string, handler: (data: any) => Promise<any>) {
    this.registeredHandlers.set(name, handler);
    this.logger.log(`Registered job handler for: ${name}`);
  }

  /**
   * Add a job to the queue. If Redis is down, runs the handler synchronously.
   */
  async addJob<T>(name: string, data: T): Promise<string> {
    if (!this.useFallback && this.queue) {
      try {
        const job = await this.queue.add(name, data);
        return job.id || "queued";
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue job [${name}]. Executing synchronously in memory.`,
          (err as any).message,
        );
        this.useFallback = true;
      }
    }

    // Sync fallback execution (fault tolerance)
    const handler = this.registeredHandlers.get(name);
    if (handler) {
      this.logger.log(
        `Executing job handler [${name}] synchronously in-memory (fallback).`,
      );
      // Run in background promise to avoid blocking the main request cycle
      handler(data).catch((err) => {
        this.logger.error(
          `Synchronous fallback execution for [${name}] failed:`,
          (err as any).message,
        );
      });
      return "sync-fallback-executed";
    }

    throw new Error(
      `Failed to process job: No handler registered for task type: ${name}`,
    );
  }
}
