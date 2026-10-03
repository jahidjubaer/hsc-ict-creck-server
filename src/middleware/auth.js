import { User } from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { AppError, forbidden, unauthorized } from '../utils/AppError.js';

/** Adds badges earned while handling this request (user.$locals.newBadges) to the JSON response. */
function attachNewBadges(req, res) {
  const json = res.json.bind(res);
  res.json = (body) => {
    const earned = req.user?.$locals?.newBadges;
    if (earned?.length && body && typeof body === 'object' && !Array.isArray(body)) body = { ...body, newBadges: earned };
    return json(body);
  };
}

/** Requires a valid access token; attaches req.user (mongoose doc). */
export async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw unauthorized('সেশনের মেয়াদ শেষ, আবার লগইন করো', 'TOKEN_EXPIRED');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized();
  req.user = user;
  attachNewBadges(req, res);
  next();
}

/** Trial or paid subscription (or admin) required. */
export function requireAccess(req, _res, next) {
  if (!req.user.accessInfo().hasAccess) {
    throw new AppError(402, 'তোমার ফ্রি ট্রায়াল শেষ। চালিয়ে যেতে সাবস্ক্রাইব করো।', 'PAYMENT_REQUIRED');
  }
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

/** Attaches req.user when a valid token is present; never rejects. */
export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    let payload;
    try {
      payload = verifyAccessToken(header.slice(7));
    } catch {
      // A signed-in student whose token expired must refresh, not silently see the guest (locked) view.
      throw unauthorized('সেশনের মেয়াদ শেষ, আবার লগইন করো', 'TOKEN_EXPIRED');
    }
    req.user = (await User.findById(payload.sub)) || undefined;
  }
  next();
}
