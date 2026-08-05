import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AssetListScreen, type AssetListItem } from "@/components/asset-list-screen";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";

type Property = {
  id: string;
  address_line1: string;
  city: string;
  province: string;
  postal_code: string;
  property_type: string;
  owner_occupied: boolean;
  year_built: number | null;
};

type PropertyCandidate = {
  id: string;
  approved_asset_id: string | null;
  display_label: string | null;
};

interface PropertyListItem extends AssetListItem {
  data: { property: Property; candidate: PropertyCandidate | null };
}

export default function Properties() {
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();
  const queryClient = useQueryClient();

  const {
    data: assets,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["properties", household?.id],
    enabled: !!household,
    queryFn: async () => {
      if (!household) return [];
      const [{ data: properties }, { data: candidates }] = await Promise.all([
        supabase
          .from("properties")
          .select(
            "id, address_line1, city, province, postal_code, property_type, owner_occupied, year_built",
          )
          .eq("household_id", household.id),
        supabase
          .from("asset_candidates")
          .select("id, approved_asset_id, display_label")
          .eq("household_id", household.id)
          .eq("approved_asset_type", "property")
          .in("review_status", ["approved", "confirmed"]),
      ]);

      const candidateByPropertyId = new Map<string, PropertyCandidate>();
      for (const candidate of candidates ?? []) {
        if (candidate.approved_asset_id) {
          candidateByPropertyId.set(candidate.approved_asset_id, candidate);
        }
      }

      const list = ((properties as Property[]) ?? []).map((property) => {
        const candidate = candidateByPropertyId.get(property.id) ?? null;
        const displayName = candidate?.display_label ?? property.address_line1;
        const subtitle = [
          property.property_type.replace("_", " "),
          [property.city, property.province, property.postal_code].filter(Boolean).join(", "),
          property.owner_occupied ? "Owner occupied" : "Rental",
          property.year_built ? `Built ${property.year_built}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const searchText = [
          displayName,
          property.address_line1,
          property.city,
          property.province,
          property.postal_code,
          property.property_type,
          property.owner_occupied ? "owner occupied" : "rental",
        ].join(" ");
        return {
          id: property.id,
          displayName,
          subtitle,
          searchText,
          data: { property, candidate },
        } as PropertyListItem;
      });

      return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
  });

  const handleOpen = (asset: PropertyListItem) => {
    router.push(`/property/${asset.id}`);
  };

  const handleEditDetails = (asset: PropertyListItem) => {
    router.push(`/property/${asset.id}`);
  };

  const handleRemove = async (asset: PropertyListItem) => {
    const { error: deleteError } = await supabase.from("properties").delete().eq("id", asset.id);
    if (deleteError) {
      throw new Error(deleteError.message);
    }
    queryClient.invalidateQueries({ queryKey: ["properties", household?.id] });
  };

  const handleRename = async (asset: PropertyListItem, newName: string) => {
    if (asset.data.candidate && household) {
      const { error: updateError } = await supabase.rpc("update_candidate_display_label_v1", {
        p_candidate_id: asset.data.candidate.id,
        p_household_id: household.id,
        p_display_label: newName.trim(),
      });
      if (updateError) throw new Error(updateError.message);
    }
    queryClient.invalidateQueries({ queryKey: ["properties", household?.id] });
  };

  return (
    <AssetListScreen<PropertyListItem>
      title="Properties"
      searchPlaceholder="Search properties"
      emptyTitle="No properties yet"
      emptyBody="Upload an insurance document to add your properties."
      emptyActionLabel="Upload document"
      onEmptyAction={() => router.push("/onboarding/documents")}
      noResultsTitle="No matching properties"
      noResultsBody="Try another name, address, city, or postal code."
      assets={assets}
      isLoading={isLoadingHousehold || isLoading}
      error={error ?? null}
      refetch={refetch}
      onOpen={handleOpen}
      onRemove={handleRemove}
      onRename={handleRename}
      onEditDetails={handleEditDetails}
    />
  );
}
