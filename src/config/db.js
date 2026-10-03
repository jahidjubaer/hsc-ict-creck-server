import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  // dbName keeps data in ict-crack even when the Atlas URI has no database path (it would default to "test").
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB });
  console.log(`✅ MongoDB connected: ${mongoose.connection.name}`);
}
