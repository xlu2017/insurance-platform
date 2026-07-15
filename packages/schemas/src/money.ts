import { z } from "zod";

/** Integer Canadian cents. Never floating-point dollars. */
export const Cents = z.number().int();
export type Cents = z.infer<typeof Cents>;

export const NonNegativeCents = Cents.nonnegative();

export function formatCad(cents: Cents): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(dollars);
}
