// src/config/config.service.ts

// 'process' geralmente é global no Node.js, mas pode adicionar o import se preferir
// import process from 'process';

export class ConfigService {
  // Garante que 'env' seja um objeto mesmo que process.env seja undefined
  private readonly env = process?.env || {};

  /**
   * Recupera uma variável de ambiente
   * @param key Nome da variável
   * @param defaultValue (Opcional) Valor padrão a retornar se a variável não for encontrada
   */
  get<T = any>(key: string, defaultValue?: T): T | undefined {
    // Retorna o valor do ambiente, ou o valor padrão se não encontrado
    return (this.env[key] as T) ?? defaultValue;
  }

  // Você pode adicionar outros métodos auxiliares aqui se necessário
}
