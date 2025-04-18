export class SettingsDto {
  rejectCall?: boolean;
  msgCall?: string;
  groupsIgnore?: boolean;
  alwaysOnline?: boolean;
  readMessages?: boolean;
  readStatus?: boolean;
  syncFullHistory?: boolean;
  wavoipToken?: string;

  constructor(data?: Partial<SettingsDto>) {
    if (data) {
      this.rejectCall = data.rejectCall;
      this.msgCall = data.msgCall;
      this.groupsIgnore = data.groupsIgnore;
      this.alwaysOnline = data.alwaysOnline;
      this.readMessages = data.readMessages;
      this.readStatus = data.readStatus;
      this.syncFullHistory = data.syncFullHistory;
      this.wavoipToken = data.wavoipToken;
    }
  }
}
