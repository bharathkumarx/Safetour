import mongoose from 'mongoose';
import app from './app.js';
import { env } from './config/env.js';

await mongoose.connect(env.MONGODB_URI);
app.listen(env.PORT, () => {
  console.log(`SafeTour API listening on port ${env.PORT}`);
});
