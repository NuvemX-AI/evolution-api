export class SettingsService {
  getSettings() {
    return {
      theme: 'default',
      notifications: true,
    };
  }
}
