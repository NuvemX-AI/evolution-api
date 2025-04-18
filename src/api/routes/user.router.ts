import { Router } from 'express';
import { UserController } from '@api/controllers/UserController';

const router = Router();

// Rota POST /users
router.post('/users', UserController.create);

export { router as UserRouter };
