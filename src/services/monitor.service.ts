export class WAMonitoringService {
  public sessions: Map<string, any>;

  constructor() {
    this.sessions = new Map<string, any>();
  }

  public async start(): Promise<string> {
    const sessionId = 'teste123'; // você pode tornar isso dinâmico se quiser
    const fakeQrCode = `data:image/png;base64,fake_qrcode_para_${sessionId}`;

    // Simula uma sessão com QR
    this.sessions.set(sessionId, {
      connected: false,
      qrCode: fakeQrCode,
    });

    return `Sessão ${sessionId} inicializada com QR gerado`;
  }

  public async getQrCode(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Sessão '${sessionId}' não encontrada`);
    }

    if (!session.qrCode) {
      throw new Error(`QR Code ainda não gerado para a sessão '${sessionId}'`);
    }

    return session.qrCode;
  }
}
