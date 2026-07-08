import { generateSecret, generateURI, verify } from 'otplib';
import qrcode from 'qrcode';

const ISSUER = 'photodrop';

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpUri(username: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: username, secret });
}

export function totpQrDataUrl(uri: string): Promise<string> {
  return qrcode.toDataURL(uri);
}

// Accept the current step plus its immediate neighbours (±1 step ≈ ±30 s), per
// RFC 6238 §5.2, so a small clock drift or a code entered at a step boundary
// still verifies. otplib's epochTolerance is in SECONDS against the default epoch
// (current time), and 30 resolves to exactly ±1 step — verified empirically:
// tokens from the −30 s / 0 / +30 s steps pass, ±60 s are rejected.
//
// On success returns the matched step (`timeStep` = floor(matchedEpochSec / 30)),
// which the caller records to reject replays of the same code.
export async function verifyTotp(
  token: string,
  secret: string,
): Promise<{ valid: true; step: number } | { valid: false }> {
  try {
    const result = await verify({ secret, token, epochTolerance: 30 });
    if (!result.valid) return { valid: false };
    // The functional verify() types its result as the TOTP|HOTP union; we only
    // ever verify TOTP, whose valid result carries `timeStep` (the matched RFC
    // 6238 step) — the value we persist to reject replays.
    const { timeStep } = result as { valid: true; timeStep: number };
    return { valid: true, step: timeStep };
  } catch {
    return { valid: false };
  }
}
