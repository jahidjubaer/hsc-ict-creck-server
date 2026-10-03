import { Router } from 'express';
import mongoose from 'mongoose';
import authRoutes from './auth.routes.js';
import learnRoutes from './learn.routes.js';
import examRoutes from './exam.routes.js';
import paymentRoutes from './payment.routes.js';
import adminRoutes from './admin.routes.js';
import gamificationRoutes from './gamification.routes.js';
import planRoutes from './plan.routes.js';
import guestRoutes from './guest.routes.js';
import { PLANS } from '../config/plans.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'up' : 'down', time: new Date().toISOString() });
});

router.get('/plans', (_req, res) => res.json({ plans: PLANS }));
router.use('/auth', authRoutes);
router.use('/guest', guestRoutes);
router.use('/exams', examRoutes);
router.use('/payments', paymentRoutes);
router.use('/admin', adminRoutes);
router.use('/plan', planRoutes);
router.use('/', gamificationRoutes);
router.use('/', learnRoutes);

export default router;
