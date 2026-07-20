import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AssetListScreen, type AssetListItem } from "@/components/asset-list-screen";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";

type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  financing_status: string | null;
  vehicle_use_class: string | null;
  is_classic: boolean;
  is_modified: boolean;
};

type VehicleCandidate = {
  id: string;
  approved_asset_id: string | null;
  display_label: string | null;
};

interface VehicleListItem extends AssetListItem {
  data: { vehicle: Vehicle; candidate: VehicleCandidate | null };
}

export default function Vehicles() {
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();
  const queryClient = useQueryClient();

  const {
    data: assets,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["vehicles", household?.id],
    enabled: !!household,
    queryFn: async () => {
      if (!household) return [];
      const [{ data: vehicles }, { data: candidates }] = await Promise.all([
        supabase
          .from("vehicles")
          .select(
            "id, year, make, model, vin, financing_status, vehicle_use_class, is_classic, is_modified",
          )
          .eq("household_id", household.id),
        supabase
          .from("asset_candidates")
          .select("id, approved_asset_id, display_label")
          .eq("household_id", household.id)
          .eq("approved_asset_type", "vehicle")
          .in("review_status", ["approved", "confirmed"]),
      ]);

      const candidateByVehicleId = new Map<string, VehicleCandidate>();
      for (const candidate of candidates ?? []) {
        if (candidate.approved_asset_id) {
          candidateByVehicleId.set(candidate.approved_asset_id, candidate);
        }
      }

      const list = (vehicles ?? ([] as Vehicle[])).map((vehicle) => {
        const candidate = candidateByVehicleId.get(vehicle.id) ?? null;
        const displayName =
          candidate?.display_label ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
        const subtitle = [
          vehicle.financing_status ? vehicle.financing_status.replace("_", " ") : null,
          vehicle.vehicle_use_class ? vehicle.vehicle_use_class.replace("_", " ") : null,
          vehicle.is_classic ? "Classic" : null,
          vehicle.is_modified ? "Modified" : null,
          vehicle.vin ? `VIN ${vehicle.vin}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const searchText = [
          displayName,
          String(vehicle.year),
          vehicle.make,
          vehicle.model,
          vehicle.vin ?? "",
          vehicle.financing_status ?? "",
          vehicle.vehicle_use_class ?? "",
        ].join(" ");
        return {
          id: vehicle.id,
          displayName,
          subtitle: subtitle || undefined,
          searchText,
          data: { vehicle, candidate },
        } as VehicleListItem;
      });

      return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
  });

  const handleOpen = (asset: VehicleListItem) => {
    router.push(`/vehicle/${asset.id}`);
  };

  const handleEditDetails = (asset: VehicleListItem) => {
    router.push(`/vehicle/${asset.id}`);
  };

  const handleRemove = async (asset: VehicleListItem) => {
    const { error: deleteError } = await supabase.from("vehicles").delete().eq("id", asset.id);
    if (deleteError) {
      throw new Error(deleteError.message);
    }
    queryClient.invalidateQueries({ queryKey: ["vehicles", household?.id] });
  };

  const handleRename = async (asset: VehicleListItem, newName: string) => {
    if (asset.data.candidate) {
      const { error: updateError } = await supabase
        .from("asset_candidates")
        .update({ display_label: newName })
        .eq("id", asset.data.candidate.id);
      if (updateError) throw new Error(updateError.message);
    }
    // Vehicles do not yet have a nickname column; candidate display_label is the editable label.
    queryClient.invalidateQueries({ queryKey: ["vehicles", household?.id] });
  };

  return (
    <AssetListScreen<VehicleListItem>
      title="Vehicles"
      searchPlaceholder="Search vehicles"
      emptyTitle="No vehicles yet"
      emptyBody="Upload an insurance document to add your vehicles."
      emptyActionLabel="Upload document"
      onEmptyAction={() => router.push("/onboarding/documents")}
      noResultsTitle="No matching vehicles"
      noResultsBody="Try another name, make, model, or licence plate."
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
