import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import * as guest from '../controllers/guest.controller.js';

const router = Router();

// Visitors share the client proxy's IP, so this only stops floods (no AI or database writes behind it).
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/free-topics', guest.freeTopics);
router.post('/quiz', limiter, validate(guest.startSchema), guest.start);
router.post('/quiz/check', limiter, validate(guest.checkSchema), guest.check);

export default router;
