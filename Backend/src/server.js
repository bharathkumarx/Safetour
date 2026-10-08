import mongoose from 'mongoose';
import app from './app.js';
import { env } from './config/env.js';
import { reload, reloadIfChanged } from './services/dataStore.js';

await mongoose.connect(env.MONGODB_URI);
await reload();
if (env.DATA_POLL_SECONDS > 0) {
  const poller = setInterval(() => reloadIfChanged().catch((error) => console.error('data reload failed', error)), env.DATA_POLL_SECONDS * 1000);
  poller.unref();
}
app.listen(env.PORT, () => {
  console.log(`SafeTour API listening on port ${env.PORT}`);
});
