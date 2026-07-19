import type { AutoEndorsementKey, PropertyOptionalCoverageKey } from "@autopilot/schemas";

export const mandateHelp = {
  autoHouseholdDefaults:
    "These auto rules apply to every vehicle in the household unless you create a vehicle-specific override.",
  propertyHouseholdDefaults:
    "These property rules apply to every property in the household unless you create a property-specific override.",
  vehicles:
    "Open a vehicle to review its effective rules. Changing a value creates an override for that vehicle only; use household defaults to remove the override.",
  properties:
    "Open a property to review its effective rules. Changing a value creates an override for that property only; use household defaults to remove the override.",
  vehicleOverride:
    "The values shown are the rules that currently apply to this vehicle. Any change here affects only this vehicle.",
  propertyOverride:
    "The values shown are the rules that currently apply to this property. Any change here affects only this property.",
  autoCoverageForm:
    "The type of physical-damage protection you want considered for the vehicle. Liability-only excludes damage coverage for your own vehicle; broader forms add collision, comprehensive or specified-perils protection.",
  propertyCoverageForm:
    "The breadth of insured causes of loss. Comprehensive forms generally cover more causes unless excluded; named-perils or basic forms cover only the causes specifically listed in the policy.",
  coveragePreference:
    "Required rejects quotes that do not satisfy this choice. Preferred may be traded against price. Indifferent does not affect eligibility. Prohibited rejects quotes that include it.",
  limitRule:
    "Choose how a quote's coverage limit is compared with your rule. At least sets a floor, at most sets a ceiling, exactly requires a match, match current or better preserves the current protection, and any accepts any limit.",
  deductibleRule:
    "Choose how a quote's deductible is compared with your rule. At most sets the highest acceptable out-of-pocket amount, exactly requires a match, match current or better does not allow a worse deductible, and any accepts any deductible.",
  limitAmount:
    "The dollar limit used by the selected comparison rule. A coverage limit is the most the policy will pay for this item, subject to the policy wording.",
  deductibleAmount:
    "The dollar amount you would generally pay toward a covered claim before the insurer pays, subject to the policy wording.",
  autoLiability:
    "The third-party liability limit for injury or property damage you are legally responsible for while using the vehicle.",
  collisionDeductible:
    "The deductible for covered damage caused by collision or upset involving your vehicle.",
  comprehensiveDeductible:
    "The deductible for covered non-collision damage such as theft, vandalism, fire or certain weather events.",
  glassDeductible:
    "The deductible that applies to covered windshield or other automotive glass damage when the policy treats glass separately.",
  settlementBasis:
    "How the insurer values covered property damage. Replacement-cost options generally avoid depreciation when conditions are met; actual cash value generally deducts depreciation.",
  dwellingLimit:
    "The coverage limit for rebuilding or repairing the insured dwelling after a covered loss. It is not necessarily the property's market value.",
  contentsLimit:
    "The coverage limit for personal belongings at the insured property, subject to category sublimits and exclusions.",
  detachedStructuresLimit:
    "The coverage limit for structures separated from the main dwelling, such as a detached garage, shed or fence.",
  personalLiabilityLimit:
    "The personal liability limit for covered injury or property damage claims against household members.",
  additionalLivingExpenseLimit:
    "The limit for eligible extra living costs when a covered loss makes the home temporarily unfit to live in.",
  baseDeductible:
    "The standard property deductible applied to many covered losses unless a separate deductible applies.",
  waterDeductible:
    "The deductible applied to covered water losses when the insurer uses a separate water deductible.",
  windHailDeductible:
    "The deductible applied to covered wind or hail losses when the insurer uses a separate deductible for those events.",
  earthquakeDeductible:
    "The deductible applied to covered earthquake losses. It may be expressed differently by insurers, including as a percentage.",
  sewerBackup:
    "Coverage for certain losses caused by water or sewage backing up through drains, sewers or sump systems. Definitions and exclusions vary by insurer.",
  overlandWater:
    "Coverage for certain surface-water entry, such as flooding from heavy rain or overflowing bodies of water. Eligibility and exclusions vary by insurer.",
  switchingRules:
    "These rules control when the platform may recommend replacing an existing policy. Coverage requirements still have to be satisfied.",
  minimumSavings:
    "The minimum estimated annual savings, after known switching costs, required before a replacement can be recommended.",
  maximumDeductibleIncrease:
    "The largest total deductible increase you will tolerate when comparing a proposed configuration with the current policies.",
  renewalOnly:
    "When enabled, recommendations are limited to the normal renewal period, avoiding mid-term cancellation unless you later change this setting.",
  householdOptimization:
    "When enabled, home and auto options are evaluated as one household configuration so bundle pricing and total household cost can be considered.",
  splitInsurers:
    "When enabled, different policies may be placed with different insurers when that produces an eligible household configuration.",
  bundleBreakup:
    "When enabled, an existing home-and-auto bundle may be separated if the resulting policies still satisfy your requirements.",
  deductibleIncreases:
    "When disabled, a proposed policy cannot increase the applicable deductible. When enabled, increases remain limited by your maximum acceptable increase.",
  customerApproval:
    "A replacement policy cannot be finalized solely from these settings. The customer must review and approve the proposed switch.",
  paymentFrequency:
    "Your preferred premium-payment schedule. Insurer availability, fees and discounts may differ by payment frequency.",
  billingMethod:
    "Your preferred way to pay premiums. The selected insurer may support only some billing methods.",
  brokerDirect:
    "Whether you prefer coverage arranged through a broker, purchased directly from an insurer, or have no preference.",
  financialRating:
    "The lowest insurer financial-strength rating you are willing to accept. This is an eligibility constraint, not a guarantee of claims service or policy quality.",
  excludedInsurers:
    "Enabled insurers in this list are excluded from recommendations for the household, even if their quote would otherwise qualify.",
  insurerSearch:
    "Filter the insurer list by name. Searching does not change which insurers are excluded.",
} as const;

export const autoEndorsementHelp: Record<AutoEndorsementKey, string> = {
  accident_forgiveness:
    "May prevent the first qualifying at-fault accident from affecting the insurer's rating treatment, subject to eligibility and policy terms.",
  rental_vehicle_coverage:
    "Pays eligible temporary transportation or loss-of-use costs after a covered claim, up to the policy's limits and conditions.",
  non_owned_automobile:
    "Extends specified liability or damage protection when an insured person drives or rents a vehicle they do not own, subject to the endorsement wording.",
  family_protection:
    "Provides additional protection when an at-fault driver is uninsured or inadequately insured, subject to the applicable provincial endorsement.",
  depreciation_waiver:
    "For eligible newer vehicles, may settle a covered total loss without deducting normal depreciation for a defined period.",
  oem_parts:
    "Expresses a preference for original-equipment-manufacturer replacement parts when repairing covered damage. Availability and wording vary by insurer.",
  roadside_assistance:
    "Provides specified emergency services such as towing, battery boosts, fuel delivery or lockout help, subject to service limits.",
  disappearing_deductible:
    "May reduce a deductible after claim-free periods or under another insurer-defined schedule.",
  glass_coverage:
    "Provides specified protection for windshield and other automotive glass damage, sometimes with a separate deductible or repair terms.",
  telematics:
    "Uses driving or usage data to determine eligibility, discounts or pricing. Set this to prohibited when you do not want a telematics program.",
};

export const propertyOptionalCoverageHelp: Record<PropertyOptionalCoverageKey, string> = {
  equipment_breakdown:
    "Covers certain sudden mechanical, electrical or pressure-system breakdowns that ordinary property coverage may exclude.",
  service_line:
    "Covers eligible damage to underground utility or service lines for which the property owner is responsible.",
  bylaw_coverage:
    "Helps pay eligible additional rebuilding costs required by current building codes or bylaws after a covered loss.",
  home_systems:
    "Adds protection for specified household systems or equipment; scope varies and may overlap with equipment-breakdown coverage.",
  cyber:
    "Adds specified assistance or reimbursement for eligible personal cyber events such as fraud, data restoration or cyber extortion.",
  scheduled_valuables:
    "Provides item-specific coverage and limits for declared valuables such as jewellery, art, collectibles or high-value equipment.",
  home_business:
    "Adds specified protection for eligible business property or activities conducted from the insured residence.",
  short_term_rental_permission:
    "Permits or covers specified short-term rental activity that a standard home policy may otherwise restrict or exclude.",
  claims_forgiveness:
    "May prevent a first qualifying property claim from affecting the insurer's rating treatment, subject to eligibility and policy terms.",
  groundwater_seepage:
    "Adds specified protection for groundwater or seepage losses that are commonly restricted or excluded under standard wording.",
  ice_dam:
    "Adds or confirms protection for eligible damage caused by roof ice dams, subject to maintenance requirements and exclusions.",
  earthquake:
    "Adds protection for eligible earthquake-related damage, usually with a separate deductible and insurer-specific conditions.",
};
