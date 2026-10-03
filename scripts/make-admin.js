// Gives an existing account the admin role (register normally first).
// Usage: npm run make-admin -- you@example.com        (add --revoke to make it a student again)
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';

const email = process.argv.slice(2).find((a) => !a.startsWith('--'))?.toLowerCase();
const revoke = process.argv.includes('--revoke');
if (!email) {
  console.error('Usage: npm run make-admin -- <email> [--revoke]');
  process.exit(1);
}

await connectDB();
const user = await User.findOneAndUpdate({ email }, { $set: { role: revoke ? 'student' : 'admin' } }, { returnDocument: 'after' });
console.log(user ? `✔ ${user.email} is now ${user.role}` : `✖ No account with email ${email}`);
await mongoose.disconnect();
process.exit(user ? 0 : 1);
