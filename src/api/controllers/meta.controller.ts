// src/api/controllers/meta.controller.ts

export class MetaController {
  public receiveWebhook(body: any) {
    return {
      success: true,
      message: 'Webhook Meta recebido com sucesso!',
      data: body,
    };
  }
}

export const metaController = new MetaController();
