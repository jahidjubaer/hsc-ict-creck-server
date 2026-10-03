import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { AppError, unauthorized } from '../utils/AppError.js';

let jwks;

/**
 * Checks a Firebase Auth ID token (from "Continue with Google" on the client) against Google's public keys.
 * Returns { uid, email, name, picture } for a verified email, otherwise throws 401.
 */
export async function verifyFirebaseToken(idToken) {
  if (!env.FIREBASE_PROJECT_ID) throw new AppError(503, 'Google লগইন এখনো চালু হয়নি', 'GOOGLE_DISABLED');
  jwks ??= createRemoteJWKSet(new URL(env.FIREBASE_JWKS_URL));

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
      algorithms: ['RS256'],
    }));
  } catch {
    throw unauthorized('Google লগইন যাচাই করা যায়নি — আবার চেষ্টা করো', 'GOOGLE_TOKEN_INVALID');
  }
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw unauthorized('Google অ্যাকাউন্টের ইমেইল যাচাই করা নেই', 'GOOGLE_EMAIL_UNVERIFIED');
  }
  return { uid: payload.sub, email: String(payload.email).toLowerCase(), name: payload.name, picture: payload.picture };
}
