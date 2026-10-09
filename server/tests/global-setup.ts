import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default function setup() {
  loadDotenv({ path: path.join(root, '.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (a disposable database; the suite truncates it).');
  const name = new URL(url).pathname.slice(1);
  if (!/test/i.test(name)) throw new Error(`Refusing to run tests against "${name}": the database name must contain "test".`);
  execSync('npx prisma migrate deploy', { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
