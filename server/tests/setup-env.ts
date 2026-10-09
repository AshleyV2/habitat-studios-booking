import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadDotenv({ path: path.join(root, '.env'), quiet: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// A local .env may have a setup link configured (a demo install). Blank = none (and .env won't override it); tests that need one set it themselves.
process.env.SETUP_TOKEN = '';
process.env.SESSION_SECRET ||= 'test-session-secret-that-is-long-enough-000';
process.env.PUBLIC_URL = 'https://book.example-studio.test';
process.env.ADDITIONAL_ORIGINS = 'https://studio.lan';
process.env.JOBS_ENABLED = 'false';
// Local-only values: signatures are generated and verified in-process; the Stripe API
// itself is replaced by tests/stripe-stub.ts and never contacted.
process.env.STRIPE_SECRET_KEY = 'sk_test_habitat_local_only';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_habitat_test';
process.env.SMTP_HOST = '';
process.env.EMAIL_FROM_ADDRESS = '';
process.env.APEXBOOK_API_URL = '';
process.env.APEXBOOK_AGENT_TOKEN = '';
