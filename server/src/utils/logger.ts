import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { env } from '../config/env';

/**
 * Writes JSON log lines to LOG_DIR/habitat-YYYY-MM-DD.log, starting a new file each
 * day and deleting files older than LOG_RETENTION_DAYS. Local, persistent logs that
 * survive container re-creation (the directory is a Docker volume).
 */
class DailyFileStream extends Writable {
  private day = '';
  private stream: fs.WriteStream | null = null;

  constructor(private readonly dir: string, private readonly retentionDays: number) {
    super();
    fs.mkdirSync(dir, { recursive: true });
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) this.rotate(today);
    this.stream!.write(chunk, cb);
  }

  private rotate(today: string) {
    this.stream?.end();
    this.day = today;
    this.stream = fs.createWriteStream(path.join(this.dir, `habitat-${today}.log`), { flags: 'a' });
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^habitat-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && Date.parse(m[1]!) < cutoff) fs.rmSync(path.join(this.dir, f), { force: true });
    }
  }
}

const redact = {
  paths: [
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers["stripe-signature"]',
    'req.headers["x-csrf-token"]',
    'res.headers["set-cookie"]',
    '*.password',
    '*.passwordHash',
    '*.token',
    '*.manageToken',
  ],
  censor: '[redacted]',
};

function build() {
  const level = env.isTest ? 'silent' : env.LOG_LEVEL;
  if (!env.isProduction && !env.isTest && !env.LOG_DIR) {
    return pino({ level, redact, transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } });
  }
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
  if (env.LOG_DIR) streams.push({ stream: new DailyFileStream(env.LOG_DIR, env.LOG_RETENTION_DAYS) });
  return pino({ level, redact, base: { app: 'habitat' } }, pino.multistream(streams));
}

export const logger = build();
