import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as p from '../controllers/plan.controller.js';

const router = Router();
router.use(auth);

router.get('/', p.get);
router.post('/', validate(p.createSchema), p.create);
router.patch('/', validate(p.updateSchema), p.replan);
router.delete('/', p.remove);
router.patch('/tasks/:taskId', validate(p.taskSchema), p.setTask);
router.get('/calendar.ics', validate(p.icsQuery, 'query'), p.calendar);

export default router;
