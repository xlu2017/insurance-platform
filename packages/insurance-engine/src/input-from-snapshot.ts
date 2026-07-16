import {
  AutoCoverageDetails,
  EngineQuote,
  type HouseholdAssets,
  HouseholdCoverageMandateV2,
  type HouseholdCoverageMandateV2 as HouseholdCoverageMandateV2Type,
  PropertyCoverageDetails,
  type QuoteComponent,
  SwitchingPreferencesV2,
  mandateV2ToEngineMandate,
} from "@autopilot/schemas";
import type { EngineInput } from "./types";
import { validateEngineInput } from "./engine";

export interface SnapshotInputError {
  code: string;
  message: string;
  details?: { quoteId?: string; componentId?: string; fieldPath?: string };
}

function collectValidationIssues(
  basePath: string,
  issues: { path: (string | number)[]; message: string }[],
): string {
  return issues.map((issue) => `${basePath}.${issue.path.join(".")}: ${issue.message}`).join("; ");
}

function validateMandateAndSwitching(
  mandate: HouseholdCoverageMandateV2Type,
  switching: { [key: string]: unknown },
): SnapshotInputError | null {
  const mandateResult = HouseholdCoverageMandateV2.safeParse(mandate);
  if (!mandateResult.success) {
    return {
      code: "INVALID_MANDATE",
      message: `Mandate validation failed: ${collectValidationIssues("mandate", mandateResult.error.issues)}`,
    };
  }
  const switchingResult = SwitchingPreferencesV2.safeParse(switching);
  if (!switchingResult.success) {
    return {
      code: "INVALID_SWITCHING_PREFERENCES",
      message: `Switching preferences validation failed: ${collectValidationIssues("switching", switchingResult.error.issues)}`,
    };
  }
  return null;
}

function validateQuoteCoverage(component: QuoteComponent): SnapshotInputError | null {
  if (component.productLine === "auto") {
    if (component.auto === null) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: "Auto component is missing auto coverage",
        details: { componentId: component.id },
      };
    }
    const result = AutoCoverageDetails.safeParse(component.auto);
    if (!result.success) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: `Auto coverage validation failed: ${collectValidationIssues("auto", result.error.issues)}`,
        details: { componentId: component.id },
      };
    }
    return null;
  }

  if (component.productLine === "property") {
    if (component.property === null) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: "Property component is missing property coverage",
        details: { componentId: component.id },
      };
    }
    const result = PropertyCoverageDetails.safeParse(component.property);
    if (!result.success) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: `Property coverage validation failed: ${collectValidationIssues("property", result.error.issues)}`,
        details: { componentId: component.id },
      };
    }
    return null;
  }

  return {
    code: "QUOTE_NOT_USABLE",
    message: `Unknown product line: ${component.productLine}`,
    details: { componentId: component.id },
  };
}

export function buildEngineInputFromSnapshot(snapshot: {
  mandate: HouseholdCoverageMandateV2Type;
  switching: { [key: string]: unknown };
  assets: HouseholdAssets;
  quotes: unknown[];
}): EngineInput | SnapshotInputError {
  const validation = validateMandateAndSwitching(snapshot.mandate, snapshot.switching);
  if (validation) return validation;

  const validatedMandate = HouseholdCoverageMandateV2.parse(snapshot.mandate);
  const validatedSwitching = SwitchingPreferencesV2.parse(snapshot.switching);

  const validatedQuotes: EngineQuote[] = [];
  for (const raw of snapshot.quotes) {
    const quoteResult = EngineQuote.safeParse(raw);
    if (!quoteResult.success) {
      const quoteId =
        typeof raw === "object" && raw !== null && "id" in raw ? String(raw.id) : undefined;
      return {
        code: "QUOTE_NOT_USABLE",
        message: `Quote validation failed: ${collectValidationIssues("quote", quoteResult.error.issues)}`,
        details: { quoteId },
      };
    }
    const quote = quoteResult.data;
    for (const component of quote.components) {
      const componentError = validateQuoteCoverage(component);
      if (componentError) return componentError;
    }
    validatedQuotes.push(quote);
  }

  const incumbentQuote = validatedQuotes.find((q) => q.isIncumbent);
  if (!incumbentQuote) {
    return { code: "QUOTE_NOT_USABLE", message: "No incumbent quote found in the case" };
  }

  const incumbentAutoComponent = incumbentQuote.components.find(
    (c): c is QuoteComponent & { auto: NonNullable<QuoteComponent["auto"]> } =>
      c.productLine === "auto" && c.auto !== null,
  );
  const incumbentPropertyComponent = incumbentQuote.components.find(
    (c): c is QuoteComponent & { property: NonNullable<QuoteComponent["property"]> } =>
      c.productLine === "property" && c.property !== null,
  );

  if (!incumbentAutoComponent) {
    return {
      code: "QUOTE_NOT_USABLE",
      message: "Incumbent quote is missing an auto component",
      details: { quoteId: incumbentQuote.id },
    };
  }
  if (!incumbentPropertyComponent) {
    return {
      code: "QUOTE_NOT_USABLE",
      message: "Incumbent quote is missing a property component",
      details: { quoteId: incumbentQuote.id },
    };
  }

  const engineMandate = mandateV2ToEngineMandate(validatedMandate, validatedSwitching);

  const input: EngineInput = {
    mandate: engineMandate,
    quotes: validatedQuotes,
    incumbentAuto: { quote: incumbentQuote, component: incumbentAutoComponent },
    incumbentProperty: { quote: incumbentQuote, component: incumbentPropertyComponent },
    assets: snapshot.assets,
  };

  const engineValidation = validateEngineInput(input);
  if (engineValidation) {
    return {
      code: engineValidation.code,
      message: engineValidation.message,
    };
  }

  return input;
}
