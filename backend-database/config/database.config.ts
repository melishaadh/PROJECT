import { registerAs } from '@nestjs/config';

export default registerAs('database', () => {
  // It will prioritize MONGODB_URI if found, then MONGO_URI
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    console.warn(
      '[Database] MONGODB_URI is not set. Provide it in your .env file.'
    );
  }

  return {
    uri: uri || 'mongodb://localhost:27017/trekeasy',
    options: {
      maxPoolSize: 50,
      minPoolSize: 5,
      // Increased timeouts to handle unstable network/DNS resolution
      socketTimeoutMS: 60000, 
      serverSelectionTimeoutMS: 15000, 
    },
  };
});