export { formatCad } from "@autopilot/schemas";

export function formatEdmontonDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "medium",
  }).format(new Date(value));
}

export function formatEdmontonDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatEdmontonDateTimeLong(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
