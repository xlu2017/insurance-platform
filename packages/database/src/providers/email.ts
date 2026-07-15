export type EmailType =
  | "verify_account"
  | "document_received"
  | "information_confirmation_requested"
  | "insurer_question_received"
  | "recommendation_ready"
  | "switch_approved"
  | "switch_completed";

export interface EmailMessage {
  to: string;
  type: EmailType;
  subject: string;
  body: string;
}

export interface EmailProvider {
  readonly name: "resend" | "outbox";
  send(message: EmailMessage): Promise<void>;
}

export interface OutboxWriter {
  write(message: EmailMessage, provider: string): Promise<void>;
}

export function createResendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(message) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.body,
        }),
      });
      if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
    },
  };
}

export function createOutboxProvider(writer: OutboxWriter): EmailProvider {
  return {
    name: "outbox",
    send: (message) => writer.write(message, "outbox"),
  };
}
