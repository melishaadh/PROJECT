import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { StorageService } from './storage.service';

/**
 * Cross-cutting infrastructure every feature module needs.
 *
 * `@Global` so the cache is a single shared instance: a like recorded through
 * `UsersService` has to invalidate the entry `RecommendationsService` is about
 * to read, which only works if both hold the same map.
 */
@Global()
@Module({
  providers: [CacheService, StorageService],
  exports: [CacheService, StorageService],
})
export class CommonModule {}
