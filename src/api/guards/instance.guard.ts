import { InstanceDto } from '../dto/instance.dto';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '../../exceptions';
import { NextFunction, Request, Response } from 'express';

async function getInstance(instanceName: string): Promise<boolean> {
  try {
    return globalThis.waMonitor?.has?.(instanceName) ?? false;
  } catch (error) {
    throw new InternalServerErrorException(error?.toString());
  }
}

export async function instanceExistsGuard(req: Request, _: Response, next: NextFunction) {
  try {
    if (
      req.originalUrl.includes('/instance/create') ||
      req.originalUrl.includes('/instance/fetchInstances')
    ) {
      return next();
    }

    const param = req.params as unknown as InstanceDto;
    if (!param?.instanceName) {
      throw new BadRequestException('"instanceName" not provided.');
    }

    const exists = await getInstance(param.instanceName);
    if (!exists) {
      throw new NotFoundException(`The "${param.instanceName}" instance does not exist`);
    }

    next();
  } catch (error) {
    next(error);
  }
}

export async function instanceLoggedGuard(req: Request, _: Response, next: NextFunction) {
  try {
    if (req.originalUrl.includes('/instance/create')) {
      const instance = req.body as InstanceDto;

      if (globalThis.waMonitor?.has?.(instance.instanceName)) {
        globalThis.waMonitor.remove?.(instance.instanceName);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}
