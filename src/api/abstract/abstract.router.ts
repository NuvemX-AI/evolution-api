/**
 * Abstração base para os Routers
 * – concentro aqui toda a lógica de validação ―
 *   deixando os arquivos de rota bem mais enxutos.
 */

import 'express-async-errors';

import { Request } from 'express';
import { JSONSchema7 } from 'json-schema';
import { validate, ValidationError } from 'jsonschema';

import { GetParticipant, GroupInvite } from '@api/dto/group.dto';
import { InstanceDto } from '@api/dto/instance.dto';

import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';

/* -------------------------------------------------------------------------- */
/*  Tipos auxiliares                                                           */
/* -------------------------------------------------------------------------- */
type DataValidate<T> = {
  request: Request;
  schema: JSONSchema7;
  /** Classe DTO que tipa/normaliza o corpo recebido */
  ClassRef: new (...args: any[]) => T;
  /** Callback que o controller de fato executa */
  execute: (instance: InstanceDto, data: T) => Promise<any>;
};

const logger = new Logger('Router-Validate');

/* -------------------------------------------------------------------------- */
/*  Classe abstrata                                                            */
/* -------------------------------------------------------------------------- */
export abstract class RouterBroker {
  /* -------------------------------- Helpers ------------------------------- */
  public routerPath(path: string, param = true): string {
    return `/${path}${param ? '/:instanceName' : ''}`;
  }

  private buildErrorMessage(errors: ValidationError[]): string {
    return errors
      .map(({ stack, schema }) =>
        schema?.description ? String(schema.description) : stack.replace('instance.', ''),
      )
      .join('\n');
  }

  /* ------------------------------- Genérica ------------------------------- */
  public async dataValidate<T>({
    request,
    schema,
    ClassRef,
    execute,
  }: DataValidate<T>) {
    // Junta tudo (body + query + params)
    const merged = { ...request.body, ...request.query, ...request.params };
    const ref = new ClassRef(merged);
    const instance = new InstanceDto(merged);

    const result = schema ? validate(ref, schema) : { valid: true, errors: [] as ValidationError[] };

    if (!result.valid) {
      const message = this.buildErrorMessage(result.errors);
      logger.error(message);
      throw new BadRequestException(message);
    }

    return execute(instance, ref);
  }

  /* ------------------ Variantes específicas abaixo (quando                  */
  /*    precisamos de parâmetros obrigatórios na query ou no body) ----------- */

  /** Sem validar instanceName na rota */
  public async groupNoValidate<T>(args: DataValidate<T>) {
    const { request, schema, ClassRef, execute } = args;

    const instance = request.params as unknown as InstanceDto;
    const ref = Object.assign(new ClassRef(), request.body);

    const result = validate(ref, schema);
    if (!result.valid) {
      throw new BadRequestException(this.buildErrorMessage(result.errors));
    }

    return execute(instance, ref);
  }

  /** Requer “groupJid” */
  public async groupValidate<T>(args: DataValidate<T>) {
    const { request, schema, ClassRef, execute } = args;

    const instance = request.params as unknown as InstanceDto;
    const body = request.body;

    let groupJid: string =
      body?.groupJid ??
      (typeof request.query?.groupJid === 'string' ? String(request.query.groupJid) : '');

    if (!groupJid) {
      throw new BadRequestException(
        'O parâmetro "groupJid" precisa ser informado na query (ex.: ?groupJid=120362@g.us)',
      );
    }

    if (!groupJid.endsWith('@g.us')) groupJid += '@g.us';
    Object.assign(body, { groupJid });

    const ref = Object.assign(new ClassRef(), body);

    const result = validate(ref, schema);
    if (!result.valid) {
      throw new BadRequestException(this.buildErrorMessage(result.errors));
    }

    return execute(instance, ref);
  }

  /** Requer “inviteCode” */
  public async inviteCodeValidate<T>(args: DataValidate<T>) {
    const { request, schema, ClassRef, execute } = args;

    const inviteCode = request.query as unknown as GroupInvite;
    if (!inviteCode?.inviteCode) {
      throw new BadRequestException(
        'É obrigatório informar "inviteCode" na query (obtido no link de convite do grupo).',
      );
    }

    const instance = request.params as unknown as InstanceDto;
    const ref = Object.assign(new ClassRef(), request.body, inviteCode);

    const result = validate(ref, schema);
    if (!result.valid) {
      throw new BadRequestException(this.buildErrorMessage(result.errors));
    }

    return execute(instance, ref);
  }

  /** Requer “getParticipants” */
  public async getParticipantsValidate<T>(args: DataValidate<T>) {
    const { request, schema, ClassRef, execute } = args;

    const gp = request.query as unknown as GetParticipant;
    if (!gp?.getParticipants) {
      throw new BadRequestException('O parâmetro "getParticipants" precisa ser informado na query.');
    }

    const instance = request.params as unknown as InstanceDto;
    const ref = Object.assign(new ClassRef(), request.body, gp);

    const result = validate(ref, schema);
    if (!result.valid) {
      throw new BadRequestException(this.buildErrorMessage(result.errors));
    }

    return execute(instance, ref);
  }
}
