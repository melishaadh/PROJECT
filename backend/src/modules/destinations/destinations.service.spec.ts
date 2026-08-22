import { CacheService } from '@/common/cache.service';
import { DestinationsService } from './destinations.service';

/**
 * The catalogue reads, at the query layer.
 *
 * `catalogueExcluding` is the mechanism behind "a completed trek is never
 * recommended", and it is the one link in that chain the engine's own suite
 * cannot check: those tests stub the destinations service out entirely, so a
 * filter built with the wrong operator — or silently dropped — would still pass
 * every one of them. What is asserted here is the exact filter object handed to
 * Mongo.
 */

interface Recorded {
  filter: Record<string, any>;
  projection: Record<string, any>;
}

function buildService(docs: { trekId: string }[] = []) {
  const calls: Recorded[] = [];
  const model = {
    find(filter: Record<string, any>, projection: Record<string, any>) {
      calls.push({ filter, projection });
      const matches = docs.filter(d => {
        const excluded = filter?.trekId?.$nin as string[] | undefined;
        return !excluded || !excluded.includes(d.trekId);
      });
      return { sort: () => ({ exec: async () => matches }) };
    },
  };
  const service = new DestinationsService(model as any, new CacheService());
  return { service, calls };
}

const CATALOGUE = [{ trekId: '1' }, { trekId: '2' }, { trekId: '3' }];

describe('DestinationsService — catalogue reads', () => {
  it('excludes the given routes with $nin rather than filtering after the read', async () => {
    const { service, calls } = buildService(CATALOGUE);

    const docs = await service.catalogueExcluding(['2']);

    expect(calls).toHaveLength(1);
    expect(calls[0].filter).toEqual({ trekId: { $nin: ['2'] } });
    expect(docs.map(d => d.trekId)).toEqual(['1', '3']);
  });

  it('reuses the shared unfiltered read when nothing is excluded', async () => {
    const { service, calls } = buildService(CATALOGUE);

    const docs = await service.catalogueExcluding([]);

    // No `$nin` for an empty set: an empty exclusion is the plain catalogue, and
    // must share its cache entry rather than minting a per-caller one.
    expect(calls[0].filter).toEqual({});
    expect(docs).toHaveLength(3);
  });

  it('de-duplicates and drops empty ids before they reach the query', async () => {
    const { service, calls } = buildService(CATALOGUE);

    await service.catalogueExcluding(['2', '2', '', '3']);

    expect(calls[0].filter).toEqual({ trekId: { $nin: ['2', '3'] } });
  });

  it('shares one cache entry regardless of the order the ids arrive in', async () => {
    const { service, calls } = buildService(CATALOGUE);

    await service.catalogueExcluding(['3', '1']);
    await service.catalogueExcluding(['1', '3']);

    // Second call served from cache — the key is order-independent.
    expect(calls).toHaveLength(1);
  });

  it('keeps a different exclusion set on its own entry', async () => {
    const { service, calls } = buildService(CATALOGUE);

    await service.catalogueExcluding(['1']);
    await service.catalogueExcluding(['2']);

    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.filter.trekId.$nin)).toEqual([['1'], ['2']]);
  });
});
