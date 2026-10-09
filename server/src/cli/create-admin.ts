/**
 * Create (or re-activate/promote) an administrator of this booking system.
 *
 *   docker compose exec app node server/dist/create-admin.js --email you@habitatstudio.co.uk --name "Your Name"
 *
 * Password: hidden prompt, or ADMIN_PASSWORD when not run interactively. Never echoed or logged.
 */
import { stdin, stdout } from 'node:process';
import readline from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { emailSchema, passwordSchema } from '@habitat/shared';
import { hashPassword } from '../auth/password';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    const r = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    let muted = false;
    r._writeToOutput = (s) => {
      if (!muted) r.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = emailSchema.parse(arg('email') ?? '');
  const name = arg('name') ?? 'Administrator';
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (!stdin.isTTY) throw new Error('Set ADMIN_PASSWORD or run in an interactive terminal (docker compose exec -it …).');
    password = await promptHidden('Password (min 12 characters): ');
    if (password !== (await promptHidden('Confirm password: '))) throw new Error('Passwords do not match.');
  }
  passwordSchema.parse(password);

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.staffUser.upsert({
      where: { email },
      update: { role: 'ADMIN', passwordHash, disabledAt: null },
      create: { email, name, role: 'ADMIN', passwordHash },
    });
    await prisma.auditLog.create({ data: { action: 'staff.admin_created_cli', targetType: 'staff', targetId: user.id, metadata: { email } } });
    console.log(`Administrator ready: ${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const issues = (err as { issues?: { message: string }[] })?.issues;
  console.error(issues ? issues.map((i) => i.message).join('\n') : err instanceof Error ? err.message : err);
  process.exit(1);
});
