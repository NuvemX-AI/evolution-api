export class ProxyDto {
  enabled?: boolean;
  host!: string;
  port!: string;
  protocol!: string;
  username?: string;
  password?: string;

  constructor(data?: Partial<ProxyDto>) {
    if (data) {
      this.enabled = data.enabled;
      this.host = data.host!;
      this.port = data.port!;
      this.protocol = data.protocol!;
      this.username = data.username;
      this.password = data.password;
    }
  }
}
