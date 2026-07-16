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

export const coveragePreferences = ["required", "preferred", "indifferent", "prohibited"] as const;
export const CoveragePreference = z.enum(coveragePreferences);
export type CoveragePreference = z.infer<typeof CoveragePreference>;

export const limitRules = [
  "minimum",
  "maximum",
  "exact",
  "match_current_or_better",
  "any",
] as const;
export const LimitRule = z.enum(limitRules);
export type LimitRule = z.infer<typeof LimitRule>;

export const deductibleRules = [
  "minimum",
  "maximum",
  "exact",
  "match_current_or_better",
  "any",
] as const;
export const DeductibleRule = z.enum(deductibleRules);
export type DeductibleRule = z.infer<typeof DeductibleRule>;

export const autoCoverageForms = [
  "liability_only",
  "collision",
  "comprehensive",
  "specified_perils",
  "all_perils",
] as const;
export const AutoCoverageForm = z.enum(autoCoverageForms);
export type AutoCoverageForm = z.infer<typeof AutoCoverageForm>;

export const propertyTypes = [
  "homeowner",
  "condo",
  "tenant",
  "landlord",
  "seasonal",
  "secondary_residence",
] as const;
export const PropertyType = z.enum(propertyTypes);
export type PropertyType = z.infer<typeof PropertyType>;

export const propertyCoverageForms = ["comprehensive", "broad", "named_perils", "basic"] as const;
export const PropertyCoverageForm = z.enum(propertyCoverageForms);
export type PropertyCoverageForm = z.infer<typeof PropertyCoverageForm>;

export const propertySettlements = [
  "replacement_cost",
  "guaranteed_replacement_cost",
  "extended_replacement_cost",
  "actual_cash_value",
] as const;
export const PropertySettlement = z.enum(propertySettlements);
export type PropertySettlement = z.infer<typeof PropertySettlement>;

export const vehicleUseClasses = ["personal", "commercial", "classic", "modified"] as const;
export const VehicleUseClass = z.enum(vehicleUseClasses);
export type VehicleUseClass = z.infer<typeof VehicleUseClass>;

export const financingStatuses = ["owned", "financed", "leased"] as const;
export const FinancingStatus = z.enum(financingStatuses);
export type FinancingStatus = z.infer<typeof FinancingStatus>;

export const paymentFrequencies = ["monthly", "quarterly", "semi_annual", "annual"] as const;
export const PaymentFrequency = z.enum(paymentFrequencies);
export type PaymentFrequency = z.infer<typeof PaymentFrequency>;

export const billingMethods = ["automatic_bank", "credit_card", "mail"] as const;
export const BillingMethod = z.enum(billingMethods);
export type BillingMethod = z.infer<typeof BillingMethod>;

export const brokerDirectPreferences = ["broker", "direct", "indifferent"] as const;
export const BrokerDirectPreference = z.enum(brokerDirectPreferences);
export type BrokerDirectPreference = z.infer<typeof BrokerDirectPreference>;

export const financialRatings = ["A_plus", "A", "A_minus", "B_plus", "B_or_lower", "any"] as const;
export const FinancialRating = z.enum(financialRatings);
export type FinancialRating = z.infer<typeof FinancialRating>;
