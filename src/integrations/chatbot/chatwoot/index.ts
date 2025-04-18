export class ChatwootService {
  constructor(waMonitor: any, configService: any, prismaRepository: any, cache?: any) {
    console.log('[ChatwootService] iniciado');
  }
}

export class ChatwootController {
  constructor(service: ChatwootService, configService: any, prismaRepository: any) {
    console.log('[ChatwootController] iniciado');
  }
}
