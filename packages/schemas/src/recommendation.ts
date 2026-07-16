import type { EngineQuote } from "./quotes";
import type { HouseholdCoverageMandateV2, SwitchingPreferencesV2 } from "./mandate-v2";

export interface HouseholdAssets {
  vehicles: Array<{ id: string }>;
  properties: Array<{ id: string }>;
}

export interface RecommendationInputSnapshot {
  mandateId: string;
  mandateVersion: number;
  mandateSchemaVersion: 2;
  jurisdiction: "AB";
  switchingPreferencesId: string;
  switchingPreferencesVersion: number;
  mandate: HouseholdCoverageMandateV2;
  switching: SwitchingPreferencesV2;
  assets: HouseholdAssets;
  quotes: EngineQuote[];
  quoteSnapshot?: { id: string; updated_at: string }[];
}
