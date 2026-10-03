import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as g from '../controllers/gamification.controller.js';

// Mounted at '/', so auth is per route (a router-wide use() would also hit /chapters for guests).
const router = Router();

router.get('/leaderboard', auth, validate(g.leaderboardQuery, 'query'), g.leaderboard);
router.get('/badges', auth, g.badges);
router.get('/stats/activity', auth, validate(g.activityQuery, 'query'), g.activity);

export default router;
