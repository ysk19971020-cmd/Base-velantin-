import { jwtVerify } from 'jose';

export async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
