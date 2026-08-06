import { supabase } from "@/lib/supabase";
import {
  autoCoverageSpecs,
  coverageSpecsByType,
  getCellValue,
  loadCompareAssets as loadCompareAssetsFromDatabase,
  propertyCoverageSpecs,
  type CompareAsset,
  type CompareAssetType,
  type CoverageSpec,
} from "@autopilot/database";

export { autoCoverageSpecs, coverageSpecsByType, getCellValue, propertyCoverageSpecs };
export type { CompareAsset, CompareAssetType, CoverageSpec };

export async function loadCompareAssets(householdId: string): Promise<CompareAsset[]> {
  return loadCompareAssetsFromDatabase(supabase, householdId);
}
