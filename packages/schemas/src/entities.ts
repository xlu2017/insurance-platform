import { z } from "zod";
import { NonNegativeCents } from "./money";
import {
  CaseState,
  ConsentType,
  DocumentCategory,
  DocumentStatus,
  ProductLine,
  QuestionStatus,
  QuestionType,
  QuoteRequestState,
  QuoteState,
  RecommendationStatus,
  SubscriptionStatus,
  SwitchState,
  UserRole,
} from "./enums";

const uuid = z.string().uuid();
const timestamptz = z.string();

export const Profile = z.object({
  id: uuid,
  role: UserRole,
  full_name: z.string(),
  email: z.string().email(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Household = z.object({
  id: uuid,
  owner_profile_id: uuid,
  name: z.string(),
  province: z.string().length(2),
  timezone: z.string().default("America/Edmonton"),
  autopilot_active: z.boolean(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Driver = z.object({
  id: uuid,
  household_id: uuid,
  full_name: z.string(),
  date_of_birth: z.string(),
  licence_class: z.string(),
  years_licensed: z.number().int().nonnegative(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Vehicle = z.object({
  id: uuid,
  household_id: uuid,
  year: z.number().int(),
  make: z.string(),
  model: z.string(),
  vin: z.string().nullable(),
  annual_km: z.number().int().nonnegative().nullable(),
  primary_use: z.string(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Property = z.object({
  id: uuid,
  household_id: uuid,
  address_line1: z.string(),
  city: z.string(),
  province: z.string().length(2),
  postal_code: z.string(),
  year_built: z.number().int().nullable(),
  dwelling_type: z.string(),
  owner_occupied: z.boolean(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Policy = z.object({
  id: uuid,
  household_id: uuid,
  insurer_id: uuid.nullable(),
  insurer_name: z.string(),
  product_line: ProductLine,
  policy_number: z.string().nullable(),
  annual_premium_cents: NonNegativeCents,
  bundle_discount_cents: NonNegativeCents,
  renewal_date: z.string(),
  is_current: z.boolean(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const PolicyDocument = z.object({
  id: uuid,
  household_id: uuid,
  policy_id: uuid.nullable(),
  category: DocumentCategory,
  status: DocumentStatus,
  storage_path: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  uploaded_by: uuid,
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const OptimizationCase = z.object({
  id: uuid,
  household_id: uuid,
  state: CaseState,
  renewal_date: z.string().nullable(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const QuoteRequest = z.object({
  id: uuid,
  case_id: uuid,
  insurer_id: uuid,
  state: QuoteRequestState,
  product_lines: z.array(ProductLine),
  inclusion_reason: z.string(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Quote = z.object({
  id: uuid,
  case_id: uuid,
  quote_request_id: uuid.nullable(),
  insurer_id: uuid,
  state: QuoteState,
  is_incumbent: z.boolean(),
  policy_fees_cents: NonNegativeCents,
  payment_fees_cents: NonNegativeCents,
  bundle_discount_cents: NonNegativeCents,
  cancellation_charge_cents: NonNegativeCents,
  underwriting_conditions: z.array(z.string()),
  expires_at: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const CustomerQuestion = z.object({
  id: uuid,
  case_id: uuid,
  question_type: QuestionType,
  status: QuestionStatus,
  prompt: z.string(),
  options: z.array(z.string()).nullable(),
  answer: z.string().nullable(),
  answered_by: uuid.nullable(),
  answered_at: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Recommendation = z.object({
  id: uuid,
  case_id: uuid,
  status: RecommendationStatus,
  version: z.number().int().positive(),
  mandate_version: z.number().int().positive(),
  current_total_cents: NonNegativeCents,
  proposed_total_cents: NonNegativeCents,
  net_savings_cents: z.number().int(),
  reason_codes: z.array(z.string()),
  disclosure_version: z.string(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const SwitchEvent = z.object({
  id: uuid,
  case_id: uuid,
  state: SwitchState,
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const Consent = z.object({
  id: uuid,
  profile_id: uuid,
  consent_type: ConsentType,
  granted: z.boolean(),
  granted_at: timestamptz,
  created_at: timestamptz,
});

export const Subscription = z.object({
  id: uuid,
  profile_id: uuid,
  status: SubscriptionStatus,
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  current_period_end: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export type Profile = z.infer<typeof Profile>;
export type Household = z.infer<typeof Household>;
export type Driver = z.infer<typeof Driver>;
export type Vehicle = z.infer<typeof Vehicle>;
export type Property = z.infer<typeof Property>;
export type Policy = z.infer<typeof Policy>;
export type PolicyDocument = z.infer<typeof PolicyDocument>;
export type OptimizationCase = z.infer<typeof OptimizationCase>;
export type QuoteRequest = z.infer<typeof QuoteRequest>;
export type Quote = z.infer<typeof Quote>;
export type CustomerQuestion = z.infer<typeof CustomerQuestion>;
export type Recommendation = z.infer<typeof Recommendation>;
export type SwitchEvent = z.infer<typeof SwitchEvent>;
export type Consent = z.infer<typeof Consent>;
export type Subscription = z.infer<typeof Subscription>;
