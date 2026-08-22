// Runs once on first container start (Mongo's docker-entrypoint-initdb.d
// convention). Pre-creates the unique/TTL indexes the schemas depend on;
// Mongoose's own autoIndex builds the rest on connect.

const dbName = process.env.MONGO_INITDB_DATABASE || 'trekeasy';
const db = db.getSiblingDB(dbName);

db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ nameLower: 1 });

db.refreshtokens.createIndex({ tokenHash: 1 }, { unique: true });
db.refreshtokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

db.destinations.createIndex({ trekId: 1 }, { unique: true });

db.userinteractions.createIndex({ userId: 1, trekId: 1, type: 1 }, { unique: true });

db.chatinvitations.createIndex(
  { roomId: 1, inviteeId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

print(`[init-indexes] indexes ensured on "${dbName}"`);
