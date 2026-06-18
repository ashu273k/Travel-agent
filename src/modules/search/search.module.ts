import { Module, Global } from "@nestjs/common";
import { AmadeusService } from "./amadeus/amadeus.service";
import { BookingService } from "./booking/booking.service";
import { ActivitiesService } from "./activities.service";
import { MemoryModule } from "../memory/memory.module";

@Global()
@Module({
  imports: [MemoryModule],
  providers: [AmadeusService, BookingService, ActivitiesService],
  exports: [AmadeusService, BookingService, ActivitiesService],
})
export class SearchModule {}
