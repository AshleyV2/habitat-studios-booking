import { createApp } from './app';
import { env } from './config/env';
import { applyIntegrations, integrations } from './config/integrations';
import { prisma } from './db/prisma';
import { startJobs, stopJobs } from './jobs/scheduler';
import { appVersion } from './services/health.service';
import { getSettings } from './services/settings.service';
import { logger } from './utils/logger';

async function main() {
  await prisma.$connect();
  // Create the settings row on a fresh installation, and load the connections saved in it.
  applyIntegrations(await getSettings());

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { version: appVersion(), port: env.PORT, publicUrl: env.PUBLIC_URL, stripe: integrations().stripe.enabled, smtp: integrations().smtp.enabled, apexbook: integrations().apexbook.enabled },
      'ApexBook booking system started',
    );
    if (!integrations().stripe.enabled) logger.warn('Stripe is not set up (Admin › Settings › Payments): customers cannot book online until it is.');
    if (!integrations().smtp.enabled) logger.warn('Email is not set up (Admin › Settings › Email): emails will queue in the outbox until it is.');
    for (const s of integrations().unreadable) logger.error(`The saved ${s} can't be decrypted (SESSION_SECRET changed?). Enter it again in Admin › Settings.`);
  });
  startJobs();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopJobs();
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
