import { Router } from 'express';
import { listEmployees } from './service.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listEmployees(req.query.department));
});

export default router;
