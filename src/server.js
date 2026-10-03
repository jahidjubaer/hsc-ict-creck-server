import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';

await connectDB();
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`🚀 API running on http://localhost:${env.PORT}/api`);
});
