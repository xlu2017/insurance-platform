import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { Body, PrimaryButton, SecondaryButton, Title } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import type { Database } from "@autopilot/database";
import { colors, radii, spacing, typography } from "@autopilot/design-tokens";

type Vehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  financing_status: string;
  vehicle_use_class: string;
  is_classic: boolean;
  is_modified: boolean;
};

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

export type EditableAsset =
  | { type: "vehicle"; asset: Vehicle }
  | { type: "property"; asset: Property };

type Candidate = { id: string; display_label: string | null } | null;

export function AssetEditModal({
  visible,
  onClose,
  payload,
  candidate,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  payload: EditableAsset;
  candidate: Candidate;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayLabel, setDisplayLabel] = useState(candidate?.display_label ?? "");

  const [vehicle, setVehicle] = useState<Vehicle>(() => ({ ...payload.asset }) as Vehicle);
  const [property, setProperty] = useState<Property>(() => ({ ...payload.asset }) as Property);

  useEffect(() => {
    if (visible) {
      setDisplayLabel(candidate?.display_label ?? "");
      if (payload.type === "vehicle") setVehicle({ ...payload.asset });
      else setProperty({ ...payload.asset });
      setError(null);
      setBusy(false);
    }
  }, [visible, payload, candidate]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      if (payload.type === "vehicle") {
        const { error: updateError } = await supabase
          .from("vehicles")
          .update({
            year: parseInt(vehicle.year.toString(), 10) || 0,
            make: vehicle.make.trim(),
            model: vehicle.model.trim(),
            vin: vehicle.vin?.trim() || null,
            financing_status:
              vehicle.financing_status.trim() as Database["public"]["Enums"]["financing_status"],
            vehicle_use_class:
              vehicle.vehicle_use_class.trim() as Database["public"]["Enums"]["vehicle_use_class"],
            is_classic: vehicle.is_classic,
            is_modified: vehicle.is_modified,
          })
          .eq("id", vehicle.id);
        if (updateError) throw new Error(updateError.message);
      } else {
        const { error: updateError } = await supabase
          .from("properties")
          .update({
            address_line1: property.address_line1.trim(),
            city: property.city.trim(),
            province: property.province.trim(),
            postal_code: property.postal_code.trim(),
            property_type:
              property.property_type.trim() as Database["public"]["Enums"]["property_type"],
            owner_occupied: property.owner_occupied,
            year_built: property.year_built ? parseInt(property.year_built.toString(), 10) : null,
          })
          .eq("id", property.id);
        if (updateError) throw new Error(updateError.message);
      }

      if (candidate) {
        const { error: candidateError } = await supabase
          .from("asset_candidates")
          .update({ display_label: displayLabel.trim() || undefined })
          .eq("id", candidate.id);
        if (candidateError) throw new Error(candidateError.message);
      }

      onSaved();
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    placeholder?: string,
    keyboardType: TextInput["props"]["keyboardType"] = "default",
  ) => (
    <View style={{ marginBottom: spacing.md }}>
      <Body
        style={{
          marginBottom: spacing.xs,
          color: colors.inkMuted,
          fontSize: typography.sizes.caption,
        }}
      >
        {label}
      </Body>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.md,
          backgroundColor: colors.surface,
          paddingHorizontal: 12,
          paddingVertical: 12,
          fontSize: typography.sizes.body,
          color: colors.ink,
          minHeight: 48,
        }}
      />
    </View>
  );

  const booleanField = (label: string, value: boolean, onToggle: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onToggle}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.md,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: spacing.md,
        minHeight: 48,
      }}
    >
      <Body>{label}</Body>
      <Body style={{ color: colors.accent, fontWeight: "600" }}>{value ? "Yes" : "No"}</Body>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "center",
          padding: spacing.lg,
        }}
      >
        <View
          style={{
            maxHeight: "85%",
            backgroundColor: colors.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            overflow: "hidden",
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Title style={{ marginBottom: spacing.md }}>
              {payload.type === "vehicle" ? "Edit vehicle" : "Edit property"}
            </Title>

            {field("Display name", displayLabel, setDisplayLabel, "Nickname shown in lists")}

            {payload.type === "vehicle" ? (
              <>
                {field(
                  "Year",
                  String(vehicle.year),
                  (text) => setVehicle((v) => ({ ...v, year: parseInt(text, 10) || 0 })),
                  "YYYY",
                  "numeric",
                )}
                {field("Make", vehicle.make, (text) => setVehicle((v) => ({ ...v, make: text })))}
                {field("Model", vehicle.model, (text) =>
                  setVehicle((v) => ({ ...v, model: text })),
                )}
                {field("VIN", vehicle.vin ?? "", (text) =>
                  setVehicle((v) => ({ ...v, vin: text })),
                )}
                {field(
                  "Financing",
                  vehicle.financing_status,
                  (text) => setVehicle((v) => ({ ...v, financing_status: text })),
                  "owned / financed / leased",
                )}
                {field(
                  "Use class",
                  vehicle.vehicle_use_class,
                  (text) => setVehicle((v) => ({ ...v, vehicle_use_class: text })),
                  "personal / commercial / classic / modified",
                )}
                {booleanField("Classic", vehicle.is_classic, () =>
                  setVehicle((v) => ({ ...v, is_classic: !v.is_classic })),
                )}
                {booleanField("Modified", vehicle.is_modified, () =>
                  setVehicle((v) => ({ ...v, is_modified: !v.is_modified })),
                )}
              </>
            ) : (
              <>
                {field("Address line 1", property.address_line1, (text) =>
                  setProperty((p) => ({ ...p, address_line1: text })),
                )}
                {field("City", property.city, (text) => setProperty((p) => ({ ...p, city: text })))}
                {field("Province", property.province, (text) =>
                  setProperty((p) => ({ ...p, province: text })),
                )}
                {field("Postal code", property.postal_code, (text) =>
                  setProperty((p) => ({ ...p, postal_code: text })),
                )}
                {field(
                  "Property type",
                  property.property_type,
                  (text) => setProperty((p) => ({ ...p, property_type: text })),
                  "homeowner / condo / tenant / landlord / seasonal / secondary_residence",
                )}
                {booleanField("Owner occupied", property.owner_occupied, () =>
                  setProperty((p) => ({ ...p, owner_occupied: !p.owner_occupied })),
                )}
                {field(
                  "Year built",
                  property.year_built ? String(property.year_built) : "",
                  (text) =>
                    setProperty((p) => ({
                      ...p,
                      year_built: text ? parseInt(text, 10) : null,
                    })),
                  "YYYY",
                  "numeric",
                )}
              </>
            )}

            {error ? (
              <Body style={{ color: colors.danger, marginBottom: spacing.md }}>{error}</Body>
            ) : null}

            <View style={{ flexDirection: "row", marginTop: spacing.md }}>
              <SecondaryButton
                label="Cancel"
                onPress={onClose}
                style={{ flex: 1, marginRight: 12 }}
              />
              <PrimaryButton label="Save" onPress={handleSave} loading={busy} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
