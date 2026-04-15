import OpenAI from 'openai';
import { config } from './env';

export const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 3,
  timeout: 60_000, // 60 seconds — vision requests can be slow
});
