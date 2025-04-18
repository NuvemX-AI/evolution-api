export class PrismaRepository {
  constructor(private configService: any) {
    console.log('PrismaRepository iniciado com config:', configService);
  }
}
