import argon2 from 'argon2';

// argon2id, OWASP baseline parameters. memoryCost is in KiB (19 MiB here),
// comfortably within the container's memory ceiling even under some concurrency.
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifySecret(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
