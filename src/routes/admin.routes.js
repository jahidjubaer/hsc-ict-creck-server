import { Router } from 'express';
import { auth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as a from '../controllers/admin.controller.js';
import * as c from '../controllers/adminContent.controller.js';

const router = Router();
router.use(auth, requireRole('admin'));

router.get('/stats', a.stats);
router.get('/meta', c.meta);

router.get('/payments', validate(a.paymentListQuery, 'query'), a.listPayments);
router.post('/payments/:id/approve', a.approvePayment);
router.post('/payments/:id/reject', validate(a.rejectSchema), a.rejectPayment);

router.get('/users', validate(a.userListQuery, 'query'), a.listUsers);
router.get('/users/:id', a.getUser);
router.post('/users/:id/extend', validate(a.extendSchema), a.extendUser);
router.post('/users/:id/cancel', validate(a.cancelSchema), a.cancelUser);

router.get('/ai-gradings', validate(c.aiListQuery, 'query'), c.listAiGradings);
router.post('/ai-gradings/:attemptId/:questionId', validate(c.reviewSchema), c.reviewAiGrading);

router.get('/questions', validate(c.questionListQuery, 'query'), c.listQuestions);
router.get('/questions/:id', c.getQuestion);
router.patch('/questions/:id', c.updateQuestion);

router.get('/settings', a.getSettings);
router.put('/settings/payment', validate(a.paymentSettingsSchema), a.updatePaymentSettings);

export default router;
