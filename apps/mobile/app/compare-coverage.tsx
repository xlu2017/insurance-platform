import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CaretDownIcon,
  CaretLeftIcon,
  CheckIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "phosphor-react-native";
import { Body, Loading, Title } from "@/components/ui";
import {
  autoCoverageSpecs,
  coverageSpecsByType,
  getCellValue,
  loadCompareAssets,
  type CompareAsset,
  type CompareAssetType,
  type CoverageSpec,
} from "@/lib/compare-coverage";
import { useHousehold } from "@/lib/household";
import { colors, radii, spacing } from "@autopilot/design-tokens";

const MAX_COLUMNS = 4;
const SPEC_WIDTH = 160;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 120;
const MAX_COL_WIDTH_RATIO = 0.45;
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 56;

type PickerMode = "add" | "replace";

function canonicalValue(asset: CompareAsset, spec: CoverageSpec): string {
  return getCellValue(asset.coverageDetails, spec, asset.type);
}

function ResizeHandle({
  onResize,
  onAutoSize,
  height,
}: {
  onResize: (dx: number) => void;
  onAutoSize: () => void;
  height?: number;
}) {
  const startDx = useRef(0);
  const lastTap = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startDx.current = 0;
      },
      onPanResponderMove: (_, gesture) => {
        onResize(gesture.dx - startDx.current);
        startDx.current = gesture.dx;
      },
      onPanResponderRelease: () => {
        startDx.current = 0;
      },
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      style={{
        position: "absolute",
        right: -4,
        top: 0,
        width: 8,
        height,
        zIndex: 2,
        justifyContent: "center",
        alignItems: "center",
      }}
      accessibilityRole="adjustable"
      accessibilityLabel="Resize column"
    >
      <Pressable
        onPress={() => {
          const now = Date.now();
          if (now - lastTap.current < 300) {
            onAutoSize();
          }
          lastTap.current = now;
        }}
        style={{
          width: 4,
          height: "60%",
          borderRadius: 2,
          backgroundColor: colors.border,
        }}
      />
    </View>
  );
}

function AssetPicker({
  open,
  onClose,
  assets,
  selected,
  allowedType,
  onSelect,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  assets: CompareAsset[];
  selected: CompareAsset[];
  allowedType?: CompareAssetType;
  onSelect: (asset: CompareAsset) => void;
  mode: PickerMode;
}) {
  const available = useMemo(() => {
    const typeFiltered = allowedType ? assets.filter((a) => a.type === allowedType) : assets;
    const selectedIds = new Set(
      mode === "add" ? selected.map((a) => a.id) : selected.map((a) => a.id),
    );
    return typeFiltered.filter((a) => !selectedIds.has(a.id));
  }, [assets, allowedType, selected, mode]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "center",
          padding: spacing.lg,
        }}
        onPress={onClose}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            maxHeight: "80%",
          }}
          onStartShouldSetResponder={() => true}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: spacing.md,
            }}
          >
            <Title style={{ marginBottom: 0 }}>
              {allowedType
                ? allowedType === "vehicle"
                  ? "Select vehicle"
                  : "Select property"
                : "Select asset"}
            </Title>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <XIcon color={colors.ink} size={24} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {available.length === 0 ? (
              <Body muted>No other assets available.</Body>
            ) : (
              available.map((asset) => (
                <Pressable
                  key={asset.id}
                  accessibilityRole="button"
                  accessibilityLabel={asset.displayName}
                  onPress={() => {
                    onSelect(asset);
                    onClose();
                  }}
                  style={{
                    paddingVertical: spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Body>{asset.displayName}</Body>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

function ConfigMenu({
  open,
  onClose,
  specs,
  hiddenSpecKeys,
  setHiddenSpecKeys,
  mode,
  setMode,
  onResetLayout,
}: {
  open: boolean;
  onClose: () => void;
  specs: CoverageSpec[];
  hiddenSpecKeys: Set<string>;
  setHiddenSpecKeys: (keys: Set<string>) => void;
  mode: "all" | "differences" | "identical";
  setMode: (m: "all" | "differences" | "identical") => void;
  onResetLayout: () => void;
}) {
  const toggleSpec = useCallback(
    (key: string) => {
      const next = new Set(hiddenSpecKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setHiddenSpecKeys(next);
    },
    [hiddenSpecKeys, setHiddenSpecKeys],
  );

  const toggleMode = useCallback(
    (target: "all" | "differences" | "identical") => {
      setMode(mode === target ? "all" : target);
    },
    [mode, setMode],
  );

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "center",
          padding: spacing.lg,
        }}
        onPress={onClose}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            maxHeight: "80%",
          }}
          onStartShouldSetResponder={() => true}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: spacing.md,
            }}
          >
            <Title style={{ marginBottom: 0 }}>Table preferences</Title>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <XIcon color={colors.ink} size={24} />
            </Pressable>
          </View>

          <View style={{ marginBottom: spacing.md }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: mode === "differences" }}
              onPress={() => toggleMode("differences")}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: mode === "differences" ? colors.accent : colors.surface,
                  justifyContent: "center",
                  alignItems: "center",
                  marginRight: spacing.sm,
                }}
              >
                {mode === "differences" ? (
                  <CheckIcon color={colors.surface} size={14} weight="bold" />
                ) : null}
              </View>
              <Body>Show only differences</Body>
            </Pressable>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: mode === "identical" }}
              onPress={() => toggleMode("identical")}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: mode === "identical" ? colors.accent : colors.surface,
                  justifyContent: "center",
                  alignItems: "center",
                  marginRight: spacing.sm,
                }}
              >
                {mode === "identical" ? (
                  <CheckIcon color={colors.surface} size={14} weight="bold" />
                ) : null}
              </View>
              <Body>Show identical rows</Body>
            </Pressable>
          </View>

          <Body style={{ fontWeight: "600", marginBottom: spacing.sm }}>
            Visible specifications
          </Body>
          <ScrollView showsVerticalScrollIndicator={false}>
            {specs.map((spec) => {
              const hidden = hiddenSpecKeys.has(spec.key);
              return (
                <Pressable
                  key={spec.key}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !hidden }}
                  onPress={() => toggleSpec(spec.key)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: !hidden ? colors.accent : colors.surface,
                      justifyContent: "center",
                      alignItems: "center",
                      marginRight: spacing.sm,
                    }}
                  >
                    {!hidden ? <CheckIcon color={colors.surface} size={14} weight="bold" /> : null}
                  </View>
                  <Body>{spec.label}</Body>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset layout"
            onPress={onResetLayout}
            style={{
              marginTop: spacing.md,
              paddingVertical: spacing.sm,
              alignItems: "center",
            }}
          >
            <Body style={{ color: colors.accent }}>Reset layout</Body>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

export default function CompareCoverage() {
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();
  const { width: screenWidth } = useWindowDimensions();
  const maxColWidth = Math.max(MIN_COL_WIDTH, screenWidth * MAX_COL_WIDTH_RATIO);

  const { data: allAssets, isLoading } = useQuery({
    queryKey: ["compare-assets", household?.id],
    enabled: !!household,
    queryFn: async () => {
      if (!household) return [];
      return loadCompareAssets(household.id);
    },
  });

  const [selectedAssets, setSelectedAssets] = useState<CompareAsset[]>([]);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [expandedSpecIndex, setExpandedSpecIndex] = useState<number | null>(null);
  const [hiddenSpecKeys, setHiddenSpecKeys] = useState<Set<string>>(new Set());
  const [showMode, setShowMode] = useState<"all" | "differences" | "identical">("all");
  const [picker, setPicker] = useState<{ open: boolean; index: number; mode: PickerMode } | null>(
    null,
  );
  const [configOpen, setConfigOpen] = useState(false);

  const headerHScrollRef = useRef<ScrollView>(null);
  const bodyHScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setColWidths((prev) => {
      const next = [...prev];
      while (next.length < selectedAssets.length) next.push(DEFAULT_COL_WIDTH);
      if (next.length > selectedAssets.length) next.length = selectedAssets.length;
      return next;
    });
  }, [selectedAssets.length]);

  const comparisonType: CompareAssetType | null = selectedAssets[0]?.type ?? null;

  const baseSpecs = useMemo(() => {
    return comparisonType ? coverageSpecsByType[comparisonType] : autoCoverageSpecs;
  }, [comparisonType]);

  const visibleSpecs = useMemo(() => {
    let specs = baseSpecs.filter((s) => !hiddenSpecKeys.has(s.key));
    if (showMode === "differences") {
      specs = specs.filter((spec) => {
        if (selectedAssets.length < 2) return true;
        const first = canonicalValue(selectedAssets[0]!, spec);
        return selectedAssets.slice(1).some((a) => canonicalValue(a, spec) !== first);
      });
    } else if (showMode === "identical") {
      specs = specs.filter((spec) => {
        if (selectedAssets.length < 2) return false;
        const first = canonicalValue(selectedAssets[0]!, spec);
        return selectedAssets.slice(1).every((a) => canonicalValue(a, spec) === first);
      });
    }
    return specs;
  }, [baseSpecs, hiddenSpecKeys, selectedAssets, showMode]);

  const handleSelectAsset = useCallback((asset: CompareAsset, index: number, mode: PickerMode) => {
    setSelectedAssets((prev) => {
      const next = [...prev];
      if (mode === "add") {
        next.push(asset);
      } else {
        next[index] = asset;
      }
      const deduped: CompareAsset[] = [];
      const seen = new Set<string>();
      for (const a of next) {
        if (a && !seen.has(a.id)) {
          seen.add(a.id);
          deduped.push(a);
        }
      }
      return deduped.slice(0, MAX_COLUMNS);
    });
    setExpandedSpecIndex(null);
  }, []);

  const handleResize = useCallback(
    (index: number, dx: number) => {
      setColWidths((prev) => {
        const next = [...prev];
        const current = next[index] ?? DEFAULT_COL_WIDTH;
        next[index] = Math.min(Math.max(current + dx, MIN_COL_WIDTH), maxColWidth);
        return next;
      });
    },
    [maxColWidth],
  );

  const handleAutoSize = useCallback(
    (index: number) => {
      setColWidths((prev) => {
        const next = [...prev];
        const asset = selectedAssets[index];
        const details = asset?.coverageDetails ?? {};
        const type = asset?.type;
        const longest = visibleSpecs.reduce((max, s) => {
          const val = getCellValue(details, s, type).length;
          return Math.max(max, val);
        }, 10);
        next[index] = Math.min(Math.max(SPEC_WIDTH, longest * 10 + 32), maxColWidth);
        return next;
      });
    },
    [maxColWidth, selectedAssets, visibleSpecs],
  );

  const resetLayout = useCallback(() => {
    setColWidths(selectedAssets.map(() => DEFAULT_COL_WIDTH));
    setHiddenSpecKeys(new Set());
    setShowMode("all");
    setExpandedSpecIndex(null);
  }, [selectedAssets.length]);

  const syncHeaderScroll = useCallback((x: number) => {
    headerHScrollRef.current?.scrollTo({ x, animated: false });
  }, []);

  if (isLoadingHousehold || isLoading) return <Loading />;

  if (!allAssets || allAssets.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            minHeight: HEADER_HEIGHT,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.navigate("/coverage")}
            style={{ position: "absolute", left: spacing.lg, padding: spacing.sm }}
          >
            <CaretLeftIcon color={colors.ink} size={28} />
          </Pressable>
          <Title style={{ marginBottom: 0 }}>Compare coverage</Title>
        </View>
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg }}
        >
          <Body muted>No assets to compare yet.</Body>
        </View>
      </SafeAreaView>
    );
  }

  const emptySlots = MAX_COLUMNS - selectedAssets.length;
  const pickerAllowedType: CompareAssetType | undefined = picker
    ? selectedAssets.length
      ? (comparisonType ?? undefined)
      : undefined
    : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        {/* Top app bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            minHeight: HEADER_HEIGHT,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.navigate("/coverage")}
            style={{ position: "absolute", left: spacing.lg, padding: spacing.sm }}
          >
            <CaretLeftIcon color={colors.ink} size={28} />
          </Pressable>
          <Title style={{ marginBottom: 0 }}>Compare coverage</Title>
        </View>

        {/* Fixed header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.surfaceSubtle,
            height: HEADER_HEIGHT,
            paddingHorizontal: spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Table preferences"
            onPress={() => setConfigOpen(true)}
            style={{
              width: SPEC_WIDTH,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <SlidersHorizontalIcon color={colors.ink} size={24} />
          </Pressable>
          <ScrollView
            ref={headerHScrollRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: "row" }}
          >
            {selectedAssets.map((asset, index) => (
              <View
                key={asset.id}
                style={{
                  width: colWidths[index] ?? DEFAULT_COL_WIDTH,
                  height: HEADER_HEIGHT,
                  paddingHorizontal: spacing.sm,
                  justifyContent: "center",
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Select asset for column ${index + 1}`}
                  onPress={() => setPicker({ open: true, index, mode: "replace" })}
                  style={{ flexDirection: "row", alignItems: "center" }}
                >
                  <Body
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontWeight: "600",
                    }}
                  >
                    {asset.displayName}
                  </Body>
                  <CaretDownIcon color={colors.inkMuted} size={16} />
                </Pressable>
                <ResizeHandle
                  height={HEADER_HEIGHT}
                  onResize={(dx) => handleResize(index, dx)}
                  onAutoSize={() => handleAutoSize(index)}
                />
              </View>
            ))}
            {Array.from({ length: emptySlots }).map((_, index) => {
              const globalIndex = selectedAssets.length + index;
              return (
                <View
                  key={`empty-${globalIndex}`}
                  style={{
                    width: colWidths[globalIndex] ?? DEFAULT_COL_WIDTH,
                    height: HEADER_HEIGHT,
                    paddingHorizontal: spacing.sm,
                    justifyContent: "center",
                    borderRightWidth: 1,
                    borderRightColor: colors.border,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add asset to column ${globalIndex + 1}`}
                    onPress={() => setPicker({ open: true, index: globalIndex, mode: "add" })}
                  >
                    <Body style={{ color: colors.accent }}>Select asset</Body>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Table body */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => setExpandedSpecIndex(null)}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View style={{ flexDirection: "row" }}>
            {/* Frozen spec column */}
            <View
              style={{ width: SPEC_WIDTH, borderRightWidth: 1, borderRightColor: colors.border }}
            >
              {visibleSpecs.map((spec, index) => (
                <View
                  key={spec.key}
                  style={{
                    height: ROW_HEIGHT,
                    justifyContent: "center",
                    paddingHorizontal: spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={spec.label}
                    onPress={() => setExpandedSpecIndex(expandedSpecIndex === index ? null : index)}
                  >
                    <Body numberOfLines={1}>{spec.label}</Body>
                  </Pressable>
                </View>
              ))}
            </View>

            {/* Asset columns */}
            <ScrollView
              ref={bodyHScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              onScroll={(e) => syncHeaderScroll(e.nativeEvent.contentOffset.x)}
              scrollEventThrottle={16}
              contentContainerStyle={{ flexDirection: "row" }}
              style={{ flex: 1 }}
            >
              {selectedAssets.map((asset, assetIndex) => (
                <View
                  key={asset.id}
                  style={{
                    width: colWidths[assetIndex] ?? DEFAULT_COL_WIDTH,
                    borderRightWidth: 1,
                    borderRightColor: colors.border,
                  }}
                >
                  {visibleSpecs.map((spec) => (
                    <View
                      key={`${asset.id}-${spec.key}`}
                      style={{
                        height: ROW_HEIGHT,
                        justifyContent: "center",
                        paddingHorizontal: spacing.sm,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      }}
                    >
                      <Body numberOfLines={1}>{canonicalValue(asset, spec)}</Body>
                    </View>
                  ))}
                </View>
              ))}
              {Array.from({ length: emptySlots }).map((_, emptyIndex) => {
                const globalIndex = selectedAssets.length + emptyIndex;
                return (
                  <View
                    key={`empty-col-${globalIndex}`}
                    style={{
                      width: colWidths[globalIndex] ?? DEFAULT_COL_WIDTH,
                      borderRightWidth: 1,
                      borderRightColor: colors.border,
                    }}
                  >
                    {visibleSpecs.map((_, i) => (
                      <View
                        key={`empty-cell-${i}`}
                        style={{
                          height: ROW_HEIGHT,
                          justifyContent: "center",
                          paddingHorizontal: spacing.sm,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <Body muted>—</Body>
                      </View>
                    ))}
                  </View>
                );
              })}
            </ScrollView>

            {/* Expanded spec overlay */}
            {expandedSpecIndex !== null && visibleSpecs[expandedSpecIndex] ? (
              <Pressable
                onPress={() => setExpandedSpecIndex(null)}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: expandedSpecIndex * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  justifyContent: "center",
                  paddingHorizontal: spacing.md,
                  zIndex: 10,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.1,
                  shadowRadius: 4,
                  elevation: 4,
                }}
              >
                <Body style={{ fontWeight: "600" }}>{visibleSpecs[expandedSpecIndex]!.label}</Body>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>

      <AssetPicker
        open={picker?.open ?? false}
        onClose={() => setPicker(null)}
        assets={allAssets}
        selected={selectedAssets}
        allowedType={pickerAllowedType}
        onSelect={(asset) => {
          if (!picker) return;
          handleSelectAsset(asset, picker.index, picker.mode);
        }}
        mode={picker?.mode ?? "add"}
      />

      <ConfigMenu
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        specs={baseSpecs}
        hiddenSpecKeys={hiddenSpecKeys}
        setHiddenSpecKeys={setHiddenSpecKeys}
        mode={showMode}
        setMode={setShowMode}
        onResetLayout={resetLayout}
      />
    </SafeAreaView>
  );
}
