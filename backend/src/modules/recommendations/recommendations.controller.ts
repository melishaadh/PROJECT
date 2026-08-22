import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { JwtAuthGuard, AuthenticatedRequest } from '@/common/guards/jwt-auth.guard';

/** Parse a `?limit=` query value, falling back when it is absent or unusable. */
function parseLimit(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : fallback;
}

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  /**
   * Popularity layer — top-N most-liked treks for the Explore trending section.
   * Members only: the Trending Now section is hidden from guests, so the data
   * behind it is gated too rather than merely hidden in the UI.
   */
  @Get('trending')
  @UseGuards(JwtAuthGuard)
  getTrending(@Query('limit') limit?: string) {
    return this.recommendationsService.getTrending(parseLimit(limit, 3));
  }

  /**
   * The same leaderboard, unauthenticated, for the public landing page's
   * "Popular Right Now" strip. It resolves through the identical aggregation as
   * the members-only route above, so the marketing page and the signed-in
   * Explore tab can never disagree about what is trending. Only aggregate like
   * counts are exposed — nothing user-identifying.
   */
  @Get('trending/public')
  getPublicTrending(@Query('limit') limit?: string) {
    return this.recommendationsService.getTrending(parseLimit(limit, 5));
  }

  /**
   * Personalized For You feed — attribute KNN + behavioural price/duration
   * affinity + hybrid collaborative filtering, with the deterministic safety
   * matrix applied last. Returns a curated window, never the whole catalogue.
   */
  @Get('foryou')
  @UseGuards(JwtAuthGuard)
  async getForYou(@Request() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : NaN;
    return this.recommendationsService.getForYou(
      req.user.userId,
      5,
      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    );
  }
}
