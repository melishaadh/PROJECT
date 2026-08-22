// Mongo init script — runs once, on the *first* start of an empty data
// volume (Mongo's own /docker-entrypoint-initdb.d/ convention).
//
// Deliberately a small subset of what backend-database/schemas/*.ts declares:
// only the constraints that matter before the NestJS app has connected even
// once — uniqueness and the refresh-token TTL. `createIndex` is idempotent
// (a no-op if the same spec already exists), so this never conflicts with
// Mongoose's own `autoIndex`, which builds the full index set — including the
// query-shape indexes this file does not repeat — from those same schema
// files the moment the API connects. The schemas remain the single source of
// truth for index *shape*; this just gets the constraints that guard data
// integrity in place before that first connection.

const dbName = process.env.MONGO_INITDB_DATABASE || 'trekeasy';
const db = db.getSiblingDB(dbName);

db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ nameLower: 1 });

db.refreshtokens.createIndex({ tokenHash: 1 }, { unique: true });
db.refreshtokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

db.destinations.createIndex({ trekId: 1 }, { unique: true });

db.userinteractions.createIndex(
  { userId: 1, trekId: 1, type: 1 },
  { unique: true }
);

db.chatinvitations.createIndex(
  { roomId: 1, inviteeId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

print(`[init-indexes] constraint indexes ensured on "${dbName}"`);
