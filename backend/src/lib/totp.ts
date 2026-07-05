import { generateSecret, generateURI, verify } from 'otplib';
import qrcode from 'qrcode';

const ISSUER = 'photodrop';

// TOTP step, in ms. otplib's default period; we shift the verification epoch by
// this to widen the acceptance window (see verifyTotp).
const PERIOD_MS = 30_000;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpUri(username: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: username, secret });
}

export function totpQrDataUrl(uri: string): Promise<string> {
  return qrcode.toDataURL(uri);
}

// Accept the current 30 s step plus its two immediate neighbours (±1 step ≈
// ±30 s), per RFC 6238 §5.2, so a small clock drift or a code entered right at a
// step boundary still verifies. This library's `epochTolerance` is effectively
// capped below one full step, so we widen the window by shifting the verification
// epoch instead of relying on it.
export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  const now = Date.now();
  for (const epoch of [now, now - PERIOD_MS, now + PERIOD_MS]) {
    try {
      const result = await verify({ secret, token, epoch });
      if (result.valid) return true;
    } catch {
      /* malformed input for this window — try the next */
    }
  }
  return false;
}
