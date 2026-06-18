import { Module, Global } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TripsRepository } from "./trips.repository";
import { TripsController } from "./trips.controller";

@Global()
@Module({
  controllers: [TripsController],
  providers: [
    PrismaService,
    {
      provide: "ITripsRepository",
      useClass: TripsRepository,
    },
  ],
  exports: [PrismaService, "ITripsRepository"],
})
export class TripsModule { }
