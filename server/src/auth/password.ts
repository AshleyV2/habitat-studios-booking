import argon2 from 'argon2';

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations).
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burn roughly the same time as a real verification when the account does not
 * exist, so login timing does not reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('apexbook-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}
