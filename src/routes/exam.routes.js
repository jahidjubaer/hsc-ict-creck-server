import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as exam from '../controllers/exam.controller.js';

const router = Router();
router.use(auth);

router.get('/overview', exam.overview);
router.get('/attempts', validate(exam.historyQuery, 'query'), exam.history);
router.post('/attempts', validate(exam.startSchema), exam.start);
router.get('/attempts/:id', exam.get);
router.patch('/attempts/:id/answers', validate(exam.draftSchema), exam.saveDraft);
router.post('/attempts/:id/mcq/:questionId', validate(exam.pickSchema), exam.answerMcq);
router.post('/attempts/:id/submit', validate(exam.draftSchema), exam.submit);
router.post('/attempts/:id/cq/:questionId/self', validate(exam.selfMarkSchema), exam.selfMark);
router.get('/mistakes', exam.listMistakes);
router.post('/mistakes/:id/retry', validate(exam.pickSchema), exam.retryMistake);

export default router;
