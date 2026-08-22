import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { ItineraryController } from './itinerary.controller';
import { ItineraryService } from './itinerary.service';
import { PersonalizationService } from './personalization.service';

@Module({
  // Needed to read the caller's onboarding state — generation is refused until
  // preferences have been saved. See `ItineraryService.generate`.
  imports: [UsersModule],
  controllers: [ItineraryController],
  providers: [ItineraryService, PersonalizationService],
})
export class ItineraryModule {}
