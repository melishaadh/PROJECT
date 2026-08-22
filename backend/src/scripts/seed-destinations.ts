/**
 * Manual destination seeder — `npm run seed:destinations`.
 *
 * The API already seeds the catalogue on every boot (see
 * `DestinationsService.onModuleInit`), so this script exists only for the cases
 * where you want to run the seed without starting the server, or to force a
 * refresh after editing `src/data/trek-metadata.ts`.
 *
 * It reuses the exact same idempotent upsert as the boot-time seeder, so real
 * like counts are never reset.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DestinationsService } from '../modules/destinations/destinations.service';
import { TREK_COUNT } from '../data/trek-metadata';

async function bootstrap() {
  const logger = new Logger('DestinationSeed');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const destinations = app.get(DestinationsService);
    const { seeded, total } = await destinations.seedCatalogue();
    logger.log(`Seeded ${seeded} of ${TREK_COUNT} destinations — collection now holds ${total}`);
  } finally {
    await app.close();
  }
}

bootstrap().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
