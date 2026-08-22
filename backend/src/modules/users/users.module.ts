import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from '@db/schemas/user.schema';
import { UserInteraction, UserInteractionSchema } from '@db/schemas/user-interaction.schema';
import { DestinationsModule } from '@/modules/destinations/destinations.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserInteraction.name, schema: UserInteractionSchema },
    ]),
    // Likes are mirrored onto the destination documents so the trending
    // leaderboard reads a live counter instead of re-aggregating per request.
    DestinationsModule,
    // Provides `AuthService`, which `deleteAccount` uses to re-verify the
    // caller's password and to revoke every refresh grant on deletion.
    AuthModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
