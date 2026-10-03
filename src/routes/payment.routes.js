import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as c from '../controllers/payment.controller.js';

const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { error: { code: 'RATE_LIMITED', message: 'অনেকবার জমা দেওয়া হয়েছে, এক ঘণ্টা পরে আবার চেষ্টা করো' } },
});

router.use(auth);
router.get('/info', c.info);
router.get('/mine', c.mine);
router.post('/', submitLimiter, validate(c.submitSchema), c.submit);

export default router;
