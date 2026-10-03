import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as c from '../controllers/auth.controller.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // In production the API is reached through the client's /api rewrite, so many students can share one
  // proxy IP; keying by IP + email keeps one student's failed logins from locking out everyone else.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
  message: { error: { code: 'RATE_LIMITED', message: 'অনেকবার চেষ্টা করা হয়েছে, ১৫ মিনিট পরে আবার চেষ্টা করো' } },
});

router.post('/register', authLimiter, validate(c.registerSchema), c.register);
router.post('/login', authLimiter, validate(c.loginSchema), c.login);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);
router.post('/logout-all', auth, c.logoutAll);
router.get('/me', auth, c.me);
router.patch('/me', auth, validate(c.updateProfileSchema), c.updateMe);
router.post('/change-password', auth, validate(c.changePasswordSchema), c.changePassword);

export default router;
