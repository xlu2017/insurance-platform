export interface PushMessage {
  profileId: string;
  title: string;
  body: string;
  actionUrl?: string;
}

export interface PushProvider {
  readonly name: "expo" | "local_log";
  send(message: PushMessage, expoPushToken?: string): Promise<void>;
}

export interface NotificationLogWriter {
  write(message: PushMessage, channel: "push" | "local_log"): Promise<void>;
}

export function createExpoPushProvider(log: NotificationLogWriter): PushProvider {
  return {
    name: "expo",
    async send(message, expoPushToken) {
      if (expoPushToken) {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: expoPushToken,
            title: message.title,
            body: message.body,
          }),
        });
      }
      await log.write(message, "push");
    },
  };
}

export function createLocalLogPushProvider(log: NotificationLogWriter): PushProvider {
  return {
    name: "local_log",
    send: (message) => log.write(message, "local_log"),
  };
}
