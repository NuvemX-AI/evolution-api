export class CacheService {
  static get(key: string): any {
    console.log(`Getting value from cache for key: ${key}`);
    return null;
  }

  static set(key: string, value: any): void {
    console.log(`Setting cache for key: ${key} with value:`, value);
  }
}
