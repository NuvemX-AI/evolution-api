// src/utils/sendTelemetry.ts
import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface TelemetryData {
  route: string;
  apiVersion: string;
  timestamp: string;          // string ISO → evita problemas de serialização
}

/** carrega a versão apenas uma vez, fora da função */
const { version: apiVersion } = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
);

/**
 * Envia um ping de telemetria (não bloqueante).
 * - Respeita a flag TELEMETRY_ENABLED (default = true).
 * - Usa TELEMETRY_URL ou o endpoint padrão do Evolution-API.
 */
export async function sendTelemetry(route: string): Promise<void> {
  const enabled =
    process.env.TELEMETRY_ENABLED === undefined ||
    process.env.TELEMETRY_ENABLED === 'true';

  if (!enabled || route === '/') return;           // nada a fazer

  const payload: TelemetryData = {
    route,
    apiVersion,
    timestamp: new Date().toISOString(),
  };

  const url =
    process.env.TELEMETRY_URL && process.env.TELEMETRY_URL.trim() !== ''
      ? process.env.TELEMETRY_URL.trim()
      : 'https://log.evolution-api.com/telemetry';

  try {
    await axios.post(url, payload, { timeout: 2_000 });
  } catch {
    /* silencia erros – não deixa a API quebrar se o endpoint estiver fora */
  }
}
