import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const dbStatus = await this.healthService.checkDatabase();
    return {
      service: 'TrekEasy API',
      ...dbStatus,
    };
  }
}
