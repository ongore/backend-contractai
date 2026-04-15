import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optionalEnv('PORT', '3001'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  isDev: optionalEnv('NODE_ENV', 'development') === 'development',
  isProd: optionalEnv('NODE_ENV', 'development') === 'production',

  database: {
    url: requireEnv('DATABASE_URL'),
  },

  supabase: {
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: requireEnv('SUPABASE_ANON_KEY'),
  },

  openai: {
    apiKey: requireEnv('OPENAI_API_KEY'),
  },

  jwt: {
    secret: requireEnv('JWT_SECRET'),
  },

  signing: {
    linkBaseUrl: optionalEnv('SIGNING_LINK_BASE_URL', 'https://sign.contractflow.app'),
  },

  upload: {
    maxFileSizeMb: parseInt(optionalEnv('MAX_FILE_SIZE_MB', '10'), 10),
  },

  limits: {
    freeContractLimit: parseInt(optionalEnv('FREE_CONTRACT_LIMIT', '1'), 10),
  },
} as const;

// Validate all required vars immediately on import
export function validateConfig(): void {
  const required = [
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'OPENAI_API_KEY',
    'JWT_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Copy .env.example to .env and fill in the values.'
    );
  }
}
