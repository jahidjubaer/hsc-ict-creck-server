import { Router } from 'express';
import { auth, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as learn from '../controllers/learn.controller.js';
import * as progress from '../controllers/progress.controller.js';

const router = Router();

// Content
router.get('/chapters', optionalAuth, learn.listChapters);
router.get('/chapters/:slug', optionalAuth, learn.getChapter);
router.get('/chapters/:slug/topics/:topicSlug', auth, learn.getTopic);

// Progress
router.get('/progress/summary', auth, progress.summary);
router.post('/progress/topics/:topicId/heartbeat', auth, validate(progress.heartbeatSchema), progress.heartbeat);
router.post('/progress/topics/:topicId/complete', auth, progress.complete);
router.patch('/progress/topics/:topicId', auth, validate(progress.updateSchema), progress.update);

export default router;
