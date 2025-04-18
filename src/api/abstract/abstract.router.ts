console.log('========== LOADING FILE: abstract.router.ts ==========');
import 'express-async-errors';

import { GetParticipant, GroupInvite } from '../dto/group.dto';
import { InstanceDto } from '../dto/instance.dto';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '../../common/exceptions';
import { Request } from 'express';
import { JSONSchema7 } from 'json-schema';
import { validate } from 'jsonschema';

type DataValidate<T> = {
  request: Request;
  schema: JSONSchema7;
  ClassRef: any;
  execute: (instance: InstanceDto, data: T) => Promise<any>;
};

const logger = new Logger('Validate');

export abstract class RouterBroker {
  constructor() {}

  public routerPath(path: string, param = true) {
    let route = '/' + path;
    param ? (route += '/:instanceName') : null;
    return route;
  }

  // === MÉTODO CORRIGIDO COM DEBUG ABSOLUTO ===
  public async dataValidate<T>(args: DataValidate<T>) {
    const { request, schema, ClassRef, execute } = args;

    // DEBUG de execução
    console.log('### DEBUG VERSÃO CORRETA CARREGADA - dataValidate');
    console.log('BODY:', request.body);
    console.log('QUERY:', request.query);
    console.log('PARAMS:', request.params);

    // Merge definitivo de todos os campos
    const merged = {
      ...request.body,
      ...request.query,
      ...request.params,
    };
    console.log('MERGED:', merged);

    // Garante passagem de dados para validação
    const ref = new ClassRef(merged);
    console.log('REF VALIDADO:', ref);

    // Instancia para controller, se necessário
    const instance = new InstanceDto(merged);

    // Mostra o schema no console
    console.log('SCHEMA:', schema);

    // Validação
    const v = schema ? validate(ref, schema) : { valid: true, errors: [] };

    if (!v.valid) {
      const messageArr: string[] = v.errors.map(({ stack, schema }) => {
        if (schema['description']) {
          return schema['description'];
        }
        return stack.replace('instance.', '');
      });
      const message = messageArr.join('\n');
      console.log('### ERRO DE VALIDAÇÃO:', message);
      logger.error(message);
      throw new BadRequestException(message);
    }

    return await execute(instance, ref);
  }

  public async groupNoValidate<T>(args: DataValidate<T>) {
    const { request, ClassRef, schema, execute } = args;

    const instance = request.params as unknown as InstanceDto;
    const ref = new ClassRef();

    Object.assign(ref, request.body);

    const v = validate(ref, schema);

    if (!v.valid) {
      const messageArr: string[] = v.errors.map(({ property, stack, schema }) => {
        if (schema['description']) {
          return schema['description'];
        }
        return stack.replace('instance.', '');
      });
      const message = messageArr.join('\n');
      logger.error(message);
      throw new BadRequestException(message);
    }

    return await execute(instance, ref);
  }

  public async groupValidate<T>(args: DataValidate<T>) {
    const { request, ClassRef, schema, execute } = args;

    const instance = request.params as unknown as InstanceDto;
    const body = request.body;

    let groupJid: string = body?.groupJid;

    if (!groupJid) {
      if (typeof request.query?.groupJid === 'string') {
        groupJid = request.query.groupJid;
      } else {
        throw new BadRequestException(
          'The group id needs to be informed in the query.\nex: "groupJid=120362@g.us"'
        );
      }
    }

    if (!groupJid.endsWith('@g.us')) {
      groupJid = groupJid + '@g.us';
    }

    Object.assign(body, {
      groupJid: groupJid,
    });

    const ref = new ClassRef();

    Object.assign(ref, body);

    const v = validate(ref, schema);

    if (!v.valid) {
      const messageArr: string[] = v.errors.map(({ property, stack, schema }) => {
        if (schema['description']) {
          return schema['description'];
        }
        return stack.replace('instance.', '');
      });
      const message = messageArr.join('\n');
      logger.error(message);
      throw new BadRequestException(message);
    }

    return await execute(instance, ref);
  }

  public async inviteCodeValidate<T>(args: DataValidate<T>) {
    const { request, ClassRef, schema, execute } = args;

    const inviteCode = request.query as unknown as GroupInvite;

    if (!inviteCode?.inviteCode) {
      throw new BadRequestException(
        'The group invite code id needs to be informed in the query.\nex: "inviteCode=F1EX5QZxO181L3TMVP31gY" (Obtained from group join link)'
      );
    }

    const instance = request.params as unknown as InstanceDto;
    const body = request.body;

    const ref = new ClassRef();

    Object.assign(body, inviteCode);
    Object.assign(ref, body);

    const v = validate(ref, schema);

    if (!v.valid) {
      const messageArr: string[] = v.errors.map(({ property, stack, schema }) => {
        if (schema['description']) {
          return schema['description'];
        }
        return stack.replace('instance.', '');
      });
      const message = messageArr.join('\n');
      logger.error(message);
      throw new BadRequestException(message);
    }

    return await execute(instance, ref);
  }

  public async getParticipantsValidate<T>(args: DataValidate<T>) {
    const { request, ClassRef, schema, execute } = args;

    const getParticipants = request.query as unknown as GetParticipant;

    if (!getParticipants?.getParticipants) {
      throw new BadRequestException('The getParticipants needs to be informed in the query');
    }

    const instance = request.params as unknown as InstanceDto;
    const body = request.body;

    const ref = new ClassRef();

    Object.assign(body, getParticipants);
    Object.assign(ref, body);

    const v = validate(ref, schema);

    if (!v.valid) {
      const messageArr: string[] = v.errors.map(({ property, stack, schema }) => {
        if (schema['description']) {
          return schema['description'];
        }
        return stack.replace('instance.', '');
      });
      const message = messageArr.join('\n');
      logger.error(message);
      throw new BadRequestException(message);
    }

    return await execute(instance, ref);
  }
}
