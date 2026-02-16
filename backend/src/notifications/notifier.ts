import type { NotificationChannel, NotificationEvent } from "./types.js";

export class Notifier {
  private readonly channels: NotificationChannel[];

  constructor(channels: NotificationChannel[]) {
    this.channels = channels.filter((c) => c.isEnabled());
  }

  async notify(event: NotificationEvent): Promise<void> {
    if (this.channels.length === 0) return;
    await Promise.allSettled(this.channels.map((c) => c.send(event)));
  }
}
