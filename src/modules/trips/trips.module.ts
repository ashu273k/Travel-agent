import { Module, Global } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TripsRepository } from "./trips.repository";
import { TripsController } from "./trips.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Global()
@Module({
  imports: [NotificationsModule],
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
