import { Router } from 'express';
import { configService } from '@config/env.config';
import { InstanceRouter } from './instance.router';

export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

export const router = Router();

router.use('/instance', new InstanceRouter(configService).router);
