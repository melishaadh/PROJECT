import { Module } from '@nestjs/common';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { UsersModule } from '@/modules/users/users.module';
import { DestinationsModule } from '@/modules/destinations/destinations.module';

@Module({
  imports: [UsersModule, DestinationsModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
})
export class RecommendationsModule {}
