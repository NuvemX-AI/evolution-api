// src/api/server/services/wa-monitoring.service.ts

import { Logger } from '@config/logger.config';

// Tipo local para representar uma instância do WhatsApp
export type Instance = {
  id?: string;
  client?: any;
  session?: any;
  socket?: any;
  status?: string;
  [key: string]: any;
};

export class WAMonitoringService {
  private readonly waInstances: Map<string, Instance> = new Map();
  private readonly logger = new Logger('WAMonitor');

  public get(instanceName: string): Instance | undefined {
    return this.waInstances.get(instanceName);
  }

  public set(instanceName: string, instance: Instance): void {
    this.logger.debug(`Setando instância "${instanceName}"`);
    this.waInstances.set(instanceName, instance);
  }

  public has(instanceName: string): boolean {
    return this.waInstances.has(instanceName);
  }

  public remove(instanceName: string): boolean {
    const result = this.waInstances.delete(instanceName);
    this.logger.debug(`Removendo instância "${instanceName}": ${result}`);
    return result;
  }

  public getAll(): Map<string, Instance> {
    return this.waInstances;
  }

  public clear(): void {
    this.logger.warn(`Limpando todas as instâncias do monitor`);
    this.waInstances.clear();
  }

  public list(): string[] {
    return Array.from(this.waInstances.keys());
  }

  public async init(): Promise<void> {
    this.logger.log('🟢 WAMonitoringService iniciado');
  }

  public async shutdown(): Promise<void> {
    this.logger.log('🔴 WAMonitoringService encerrado');
  }
}
