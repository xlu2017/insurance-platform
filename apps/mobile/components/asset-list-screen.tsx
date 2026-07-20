import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { CaretLeftIcon } from "phosphor-react-native";
import { router, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, PrimaryButton, Screen, SecondaryButton, Subtitle, Title } from "@/components/ui";
import { AssetNavigationRow } from "@/components/asset-navigation-row";
import { matchesSearch } from "@/lib/search";
import { colors, radii, spacing, typography } from "@autopilot/design-tokens";

export interface AssetListItem {
  id: string;
  displayName: string;
  subtitle?: string;
  searchText: string;
}

export interface AssetListScreenProps<T extends AssetListItem> {
  title: string;
  backRoute?: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyBody: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  noResultsTitle: string;
  noResultsBody: string;
  assets: T[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  onOpen: (asset: T) => void;
  onRemove: (asset: T) => Promise<void> | void;
  onRename?: (asset: T, newName: string) => Promise<void> | void;
  onEditDetails?: (asset: T) => void;
}

function SkeletonRow() {
  return (
    <View
      style={{
        backgroundColor: colors.border,
        borderRadius: radii.md,
        minHeight: 56,
        marginBottom: 12,
      }}
    />
  );
}

export function AssetListScreen<T extends AssetListItem>({
  title,
  backRoute,
  searchPlaceholder,
  emptyTitle,
  emptyBody,
  emptyActionLabel,
  onEmptyAction,
  noResultsTitle,
  noResultsBody,
  assets,
  isLoading,
  error,
  refetch,
  onOpen,
  onRemove,
  onRename,
  onEditDetails,
}: AssetListScreenProps<T>) {
  const [query, setQuery] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [renameTarget, setRenameTarget] = useState<T | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [removeTarget, setRemoveTarget] = useState<T | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!assets) return [];
    return assets.filter((asset) => matchesSearch(asset.searchText, query));
  }, [assets, query]);

  const closeRename = () => {
    setRenameTarget(null);
    setRenameValue("");
    setActionError(null);
  };

  const handleRename = async () => {
    if (!renameTarget || !onRename) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await onRename(renameTarget, renameValue.trim() || renameTarget.displayName);
      closeRename();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setActionBusy(false);
    }
  };

  const closeRemove = () => {
    setRemoveTarget(null);
    setActionError(null);
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await onRemove(removeTarget);
      closeRemove();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setActionBusy(false);
    }
  };

  const headerTitle = title;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen style={{ flex: 1, padding: 0 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            minHeight: 56,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (backRoute ? router.navigate(backRoute) : router.back())}
            style={{
              position: "absolute",
              left: spacing.lg,
              padding: spacing.sm,
              minWidth: 44,
              minHeight: 44,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <CaretLeftIcon color={colors.ink} size={28} />
          </Pressable>
          <Title style={{ marginBottom: 0 }}>{headerTitle}</Title>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 0,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginTop: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.md,
                backgroundColor: colors.surface,
                paddingHorizontal: 12,
                minHeight: 44,
              }}
            >
              <TextInput
                accessibilityLabel={searchPlaceholder}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.inkMuted}
                value={query}
                onChangeText={setQuery}
                style={{
                  flex: 1,
                  fontSize: typography.sizes.body,
                  color: colors.ink,
                  minHeight: 44,
                }}
              />
              {query.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setQuery("")}
                  style={{ padding: spacing.xs }}
                >
                  <Body style={{ color: colors.inkMuted }}>×</Body>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editMode ? "Done" : "Edit"}
              onPress={() => setEditMode((value) => !value)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                minWidth: 44,
                minHeight: 44,
                justifyContent: "center",
              }}
            >
              {editMode ? (
                <Body style={{ fontWeight: "600" }}>Done</Body>
              ) : (
                <>
                  <Body style={{ fontWeight: "600" }}>Edit</Body>
                  <Body style={{ marginLeft: 4, color: colors.inkMuted }}>✎</Body>
                </>
              )}
            </Pressable>
          </View>

          {error ? (
            <View style={{ marginTop: spacing.xl }}>
              <Title style={{ fontSize: typography.sizes.subtitle, marginBottom: spacing.sm }}>
                We couldn’t load your {title.toLowerCase()}
              </Title>
              <Body muted style={{ marginBottom: spacing.md }}>
                Check your connection and try again.
              </Body>
              <PrimaryButton label="Try again" onPress={refetch} />
            </View>
          ) : isLoading ? (
            <View style={{ marginTop: spacing.md }}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </View>
          ) : !assets || assets.length === 0 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Subtitle style={{ marginBottom: spacing.sm }}>{emptyTitle}</Subtitle>
              <Body muted style={{ marginBottom: spacing.md }}>
                {emptyBody}
              </Body>
              {emptyActionLabel && onEmptyAction ? (
                <PrimaryButton label={emptyActionLabel} onPress={onEmptyAction} />
              ) : null}
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Subtitle style={{ marginBottom: spacing.sm }}>{noResultsTitle}</Subtitle>
              <Body muted style={{ marginBottom: spacing.md }}>
                {noResultsBody}
              </Body>
              <Pressable accessibilityRole="button" onPress={() => setQuery("")}>
                <Body style={{ color: colors.accent }}>Clear search</Body>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {filtered.map((asset) => (
                <AssetNavigationRow
                  key={asset.id}
                  title={asset.displayName}
                  subtitle={asset.subtitle}
                  editMode={editMode}
                  onPress={() => onOpen(asset)}
                  onEditDetails={onEditDetails ? () => onEditDetails(asset) : undefined}
                  onRemove={() => setRemoveTarget(asset)}
                  onRename={
                    onRename
                      ? () => {
                          setRenameTarget(asset);
                          setRenameValue(asset.displayName);
                        }
                      : undefined
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>
      </Screen>

      <Modal animationType="fade" transparent visible={!!renameTarget} onRequestClose={closeRename}>
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "center",
            padding: spacing.lg,
          }}
          onPress={closeRename}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radii.lg,
              padding: spacing.lg,
            }}
          >
            <Subtitle style={{ marginBottom: spacing.sm }}>Rename</Subtitle>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.md,
                padding: 12,
                fontSize: typography.sizes.body,
                color: colors.ink,
                marginBottom: spacing.md,
              }}
            />
            {actionError ? (
              <Body style={{ color: colors.danger, marginBottom: spacing.sm }}>{actionError}</Body>
            ) : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.md }}>
              <SecondaryButton label="Cancel" onPress={closeRename} />
              <PrimaryButton label="Save" onPress={handleRename} loading={actionBusy} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={!!removeTarget} onRequestClose={closeRemove}>
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "center",
            padding: spacing.lg,
          }}
          onPress={closeRemove}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radii.lg,
              padding: spacing.lg,
            }}
          >
            <Subtitle style={{ marginBottom: spacing.sm }}>
              Remove {removeTarget?.displayName ?? "asset"}?
            </Subtitle>
            <Body muted style={{ marginBottom: spacing.md }}>
              This {title.toLowerCase().replace(/s$/, "")} will be removed from your household and
              will no longer be included in coverage or quote comparisons.
            </Body>
            {actionError ? (
              <Body style={{ color: colors.danger, marginBottom: spacing.sm }}>{actionError}</Body>
            ) : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.md }}>
              <SecondaryButton label="Cancel" onPress={closeRemove} />
              <PrimaryButton label="Remove" onPress={handleRemove} loading={actionBusy} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
