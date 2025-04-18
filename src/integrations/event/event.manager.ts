export class EventManager {
  constructor(private prisma: any, private waMonitor: any) {
    console.log('[EventManager] iniciado');
  }

  public async init() {
    console.log('[EventManager] método init executado');
    // coloque inicializações de eventos aqui no futuro
  }
}
