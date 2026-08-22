import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import databaseConfig from '@db/config/database.config';
import jwtConfig from '@db/config/jwt.config';
import { CommonModule } from './common/common.module';
import { ResourceOwnerGuard } from './common/guards/resource-owner.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { DestinationsModule } from './modules/destinations/destinations.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { ItineraryModule } from './modules/itinerary/itinerary.module';
import { ChatModule } from './modules/chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
      envFilePath: ['.env', '.env.local'],
    }),

    /**
     * Global rate limiting.
     *
     * Exactly **one** named bucket, deliberately.
     *
     * `ThrottlerModule.forRoot([...])` enforces *every* configured bucket on
     * *every* route — the names are not opt-in labels. Declaring a tight
     * `strict` bucket alongside `default` therefore applied that tight limit
     * app-wide, and a single screen that loads a feed, the like counts and the
     * leaderboard together immediately started getting 429s. Tighter limits
     * belong on the individual route via `@Throttle({ default: {...} })`, which
     * *overrides* this budget for that handler rather than stacking with it.
     *
     * 120/minute is sized for real browsing: several parallel requests per
     * screen, with headroom for a pull-to-refresh, but nowhere near enough to
     * enumerate the catalogue or the user directory in bulk.
     *
     * Applied as an `APP_GUARD`, so a newly added route is rate-limited by
     * default and has to opt *out* — the safe direction for an oversight.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        // Fetch the 'database' configuration object we defined in registerAs
        const dbConfig = configService.get('database');
        return {
          uri: dbConfig.uri,
          ...dbConfig.options,
        };
      },
      inject: [ConfigService],
    }),

    CommonModule,
    AuthModule,
    UsersModule,
    HealthModule,
    DestinationsModule,
    RecommendationsModule,
    ItineraryModule,
    ChatModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Runs on every request but is a no-op unless the handler carries
    // `@OwnedBy(...)`. Registering it globally is what makes it impossible to
    // add an id-addressed route and quietly forget the ownership check.
    { provide: APP_GUARD, useClass: ResourceOwnerGuard },
  ],
})
export class AppModule {}
