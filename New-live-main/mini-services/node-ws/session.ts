// Same signed-JWT session verification as src/lib/session.ts in the Next.js
// app and mini-services/cloudflare-ws/src/session.ts. The realtime service
// must verify the token itself rather than trusting a client-declared
// userId.

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
