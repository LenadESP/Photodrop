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

// Allow ±30 s of clock skew between the phone and the server.
export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}
