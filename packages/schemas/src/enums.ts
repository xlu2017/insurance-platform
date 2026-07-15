import { z } from "zod";

export const userRoles = ["customer", "operations", "reviewer", "admin"] as const;
export const UserRole = z.enum(userRoles);
export type UserRole = z.infer<typeof UserRole>;

export const caseStates = [
  "draft",
  "awaiting_documents",
  "extracting_information",
  "awaiting_customer_confirmation",
  "ready_for_market_search",
  "requesting_quotes",
  "awaiting_quotes",
  "comparing_quotes",
  "licensed_review",
  "recommendation_ready",
  "customer_decision",
  "switching",
  "completed",
  "retained_incumbent",
  "cancelled",
] as const;
export const CaseState = z.enum(caseStates);
export type CaseState = z.infer<typeof CaseState>;

export const quoteRequestStates = [
  "draft",
  "queued",
  "sent",
  "additional_information_required",
  "response_received",
  "declined",
  "no_response",
  "cancelled",
] as const;
export const QuoteRequestState = z.enum(quoteRequestStates);
export type QuoteRequestState = z.infer<typeof QuoteRequestState>;

export const quoteStates = [
  "estimate",
  "conditional",
  "bindable",
  "expired",
  "rejected",
  "selected",
] as const;
export const QuoteState = z.enum(quoteStates);
export type QuoteState = z.infer<typeof QuoteState>;

export const switchStates = [
  "customer_approved",
  "replacement_pending",
  "replacement_confirmed",
  "incumbent_cancellation_pending",
  "incumbent_cancelled",
  "completed",
  "failed",
] as const;
export const SwitchState = z.enum(switchStates);
export type SwitchState = z.infer<typeof SwitchState>;

export const productLines = ["auto", "property"] as const;
export const ProductLine = z.enum(productLines);
export type ProductLine = z.infer<typeof ProductLine>;

export const documentCategories = [
  "current_auto_policy",
  "current_property_policy",
  "renewal_notice",
  "competing_quote",
  "proof_of_insurance",
  "signed_authorization",
  "cancellation_confirmation",
  "other",
] as const;
export const DocumentCategory = z.enum(documentCategories);
export type DocumentCategory = z.infer<typeof DocumentCategory>;

export const documentStatuses = ["uploaded", "in_review", "extracted", "rejected"] as const;
export const DocumentStatus = z.enum(documentStatuses);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const questionTypes = [
  "yes_no",
  "single_choice",
  "multiple_choice",
  "number",
  "date",
  "short_text",
] as const;
export const QuestionType = z.enum(questionTypes);
export type QuestionType = z.infer<typeof QuestionType>;

export const questionStatuses = ["pending", "answered", "cancelled"] as const;
export const QuestionStatus = z.enum(questionStatuses);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const consentTypes = [
  "store_documents",
  "share_for_quotation",
  "generate_recommendations",
  "electronic_communications",
] as const;
export const ConsentType = z.enum(consentTypes);
export type ConsentType = z.infer<typeof ConsentType>;

export const subscriptionStatuses = [
  "inactive",
  "pending",
  "active",
  "past_due",
  "cancelled",
] as const;
export const SubscriptionStatus = z.enum(subscriptionStatuses);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const recommendationStatuses = [
  "draft",
  "awaiting_review",
  "approved",
  "rejected",
  "published",
  "customer_approved",
  "customer_declined",
  "superseded",
] as const;
export const RecommendationStatus = z.enum(recommendationStatuses);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;

export const notificationChannels = ["push", "email", "local_log"] as const;
export const NotificationChannel = z.enum(notificationChannels);
export type NotificationChannel = z.infer<typeof NotificationChannel>;
