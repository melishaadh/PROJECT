import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  IsString, IsNotEmpty, IsOptional, IsNumber, IsInt, Min,
} from 'class-validator';
import { AuthenticatedRequest } from '@/common/guards/jwt-auth.guard';
import { ItineraryService } from './itinerary.service';

// Decorated DTO so the global ValidationPipe (whitelist: true) keeps every field.
class GenerateItineraryDto {
  @IsString()
  @IsNotEmpty()
  trekId!: string;

  @IsOptional()
  @IsString()
  pace?: string;

  @IsOptional()
  @IsString()
  fitnessLevel?: string;

  @IsOptional()
  @IsString()
  trekkingExperience?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetDays?: number;

  @IsOptional()
  @IsNumber()
  age?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  groupSize?: number;

  /*
    No `previousTreks`. The engine now derives track record from the completed
    treks on the user's profile document, which the client cannot assert.
    `forbidNonWhitelisted` is on, so a stale client still sending the field gets
    a 400 rather than having it silently ignored — the honest failure.
  */

  @IsOptional()
  @IsString()
  startLocation?: string;

  @IsOptional()
  @IsString()
  finalDestination?: string;
}

@Controller('itinerary')
export class ItineraryController {
  constructor(private readonly itineraryService: ItineraryService) {}

  /**
   * Generation is gated twice over, and both gates are here rather than in the
   * client so neither can be skipped by calling the API directly:
   *
   *   · `AuthGuard('jwt')` — a guest has no itinerary at all.
   *   · the onboarding check inside the service — a signed-in account that has
   *     not saved its preferences yet has nothing to personalise against, and
   *     planning off silent defaults would hand back a plan the user never
   *     described.
   */
  @Post('generate')
  @UseGuards(AuthGuard('jwt'))
  generate(@Request() req: AuthenticatedRequest, @Body() body: GenerateItineraryDto) {
    return this.itineraryService.generate(req.user.userId, body);
  }

  @Get('locations')
  getLocations() {
    return this.itineraryService.getLocations();
  }
}
