import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowsHorizontalIcon,
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
const TABLE_HEADER_HEIGHT = 44;
const APP_BAR_HEIGHT = 56;
const HANDLE_SIZE = 32;

type PickerMode = "add" | "replace";

function canonicalValue(asset: CompareAsset, spec: CoverageSpec): string {
  return getCellValue(asset.coverageDetails, spec, asset.type);
}

function Divider() {
  return (
    <View
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 1,
        backgroundColor: colors.border,
      }}
    />
  );
}

function ResizeHandle({
  top,
  onResize,
  onAutoSize,
  onResizeStart,
  onResizeEnd,
}: {
  top: number;
  onResize: (dx: number) => void;
  onAutoSize: () => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const visible = hovered || active;
  const defaultOpacity = Platform.OS === "web" ? 0.2 : 0;
  const iconOpacity = useRef(new Animated.Value(defaultOpacity)).current;
  const startDx = useRef(0);

  useEffect(() => {
    Animated.timing(iconOpacity, {
      toValue: visible ? 1 : defaultOpacity,
      duration: 175,
      useNativeDriver: false,
    }).start();
  }, [visible]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setActive(true);
        startDx.current = 0;
        onResizeStart?.();
      },
      onPanResponderMove: (_, gesture) => {
        onResize(gesture.dx - startDx.current);
        startDx.current = gesture.dx;
      },
      onPanResponderRelease: (_, gesture) => {
        setActive(false);
        startDx.current = 0;
        onResizeEnd?.();
        if (Math.abs(gesture.dx) < 3 && Math.abs(gesture.dy) < 3) {
          onAutoSize();
        }
      },
      onPanResponderTerminate: () => {
        setActive(false);
        startDx.current = 0;
        onResizeEnd?.();
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={() => onResizeStart?.()}
      style={{
        position: "absolute",
        right: -HANDLE_SIZE / 2,
        top,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        justifyContent: "center",
        alignItems: "center",
        zIndex: 10,
      }}
    >
      <Animated.View
        {...pan.panHandlers}
        style={{
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: HANDLE_SIZE / 2,
          backgroundColor: visible ? "rgba(0,0,0,0.08)" : "transparent",
          justifyContent: "center",
          alignItems: "center",
          opacity: iconOpacity,
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Resize column"
      >
        <ArrowsHorizontalIcon
          color={visible ? colors.ink : colors.inkMuted}
          size={16}
          weight="bold"
        />
      </Animated.View>
    </Pressable>
  );
}

function AssetColumnHeader({
  asset,
  index,
  colWidth,
  onSelect,
  onResize,
  onAutoSize,
  onResizeStart,
  onResizeEnd,
}: {
  asset?: CompareAsset;
  index: number;
  colWidth: number;
  onSelect: () => void;
  onResize: (dx: number) => void;
  onAutoSize: () => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}) {
  return (
    <View
      style={{
        width: colWidth,
        height: TABLE_HEADER_HEIGHT,
        position: "relative",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          asset ? `Change asset for column ${index + 1}` : `Add asset to column ${index + 1}`
        }
        onPress={onSelect}
        style={{
          width: "100%",
          height: "100%",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            width: "100%",
          }}
        >
          {asset ? (
            <>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Body
                  numberOfLines={1}
                  style={{ fontWeight: "600", textAlign: "center", width: "100%" }}
                >
                  {asset.displayName}
                </Body>
              </View>
              <CaretDownIcon color={colors.inkMuted} size={16} />
            </>
          ) : (
            <View style={{ flex: 1, alignItems: "center" }}>
              <Body style={{ color: colors.accent, textAlign: "center", width: "100%" }}>
                Select asset
              </Body>
            </View>
          )}
        </View>
      </Pressable>
      <Divider />
      {asset ? (
        <ResizeHandle
          top={TABLE_HEADER_HEIGHT / 2 - HANDLE_SIZE / 2}
          onResize={onResize}
          onAutoSize={onAutoSize}
          onResizeStart={onResizeStart}
          onResizeEnd={onResizeEnd}
        />
      ) : null}
    </View>
  );
}

function AssetColumnBody({
  asset,
  colWidth,
  specs,
  onResize,
  onAutoSize,
  onResizeStart,
  onResizeEnd,
}: {
  asset?: CompareAsset;
  colWidth: number;
  specs: CoverageSpec[];
  onResize: (dx: number) => void;
  onAutoSize: () => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}) {
  return (
    <View style={{ width: colWidth, position: "relative" }}>
      {specs.map((spec) => (
        <View
          key={spec.key}
          style={{
            height: ROW_HEIGHT,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Body numberOfLines={1} style={{ width: "100%", textAlign: "center" }}>
            {asset ? canonicalValue(asset, spec) : "—"}
          </Body>
        </View>
      ))}
      <Divider />
      {asset
        ? specs.map((spec, rowIndex) => {
            if ((rowIndex + 1) % 6 !== 0) return null;
            return (
              <ResizeHandle
                key={`handle-${spec.key}`}
                top={rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2 - HANDLE_SIZE / 2}
                onResize={onResize}
                onAutoSize={onAutoSize}
                onResizeStart={onResizeStart}
                onResizeEnd={onResizeEnd}
              />
            );
          })
        : null}
    </View>
  );
}

function SpecColumnHeader({ onConfig }: { onConfig: () => void }) {
  return (
    <View
      style={{
        width: SPEC_WIDTH,
        height: TABLE_HEADER_HEIGHT,
        position: "relative",
        justifyContent: "center",
        alignItems: "center",
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Table preferences"
        onPress={onConfig}
        style={{
          width: "100%",
          height: "100%",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <SlidersHorizontalIcon color={colors.ink} size={24} />
      </Pressable>
      <Divider />
    </View>
  );
}

function SpecColumnBody({
  specs,
  onToggle,
}: {
  specs: CoverageSpec[];
  onToggle: (index: number) => void;
}) {
  return (
    <View style={{ width: SPEC_WIDTH, position: "relative" }}>
      {specs.map((spec, index) => (
        <Pressable
          key={spec.key}
          accessibilityRole="button"
          accessibilityLabel={spec.label}
          onPress={() => onToggle(index)}
          style={{
            height: ROW_HEIGHT,
            justifyContent: "center",
            paddingHorizontal: spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Body numberOfLines={1} style={{ width: "100%" }}>
            {spec.label}
          </Body>
        </Pressable>
      ))}
      <Divider />
    </View>
  );
}

function AssetOverlay({
  specs,
  expandedIndex,
  totalWidth,
  onCollapse,
}: {
  specs: CoverageSpec[];
  expandedIndex: number | null;
  totalWidth: number;
  onCollapse: () => void;
}) {
  if (expandedIndex === null || !specs[expandedIndex]) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Collapse expanded specification"
      onPress={onCollapse}
      style={{
        position: "absolute",
        left: 0,
        top: expandedIndex * ROW_HEIGHT,
        width: totalWidth,
        height: ROW_HEIGHT,
        paddingHorizontal: spacing.sm,
        justifyContent: "center",
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        zIndex: 30,
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
      }}
    >
      <Body style={{ fontWeight: "600", width: "100%" }}>{specs[expandedIndex].label}</Body>
    </Pressable>
  );
}

function AssetPicker({
  open,
  onClose,
  assets,
  selected,
  allowedType,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  assets: CompareAsset[];
  selected: CompareAsset[];
  allowedType?: CompareAssetType;
  onSelect: (asset: CompareAsset) => void;
}) {
  const available = useMemo(() => {
    const typeFiltered = allowedType ? assets.filter((a) => a.type === allowedType) : assets;
    const selectedIds = new Set(selected.map((a) => a.id));
    return typeFiltered.filter((a) => !selectedIds.has(a.id));
  }, [assets, allowedType, selected]);

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
  const [resizing, setResizing] = useState(false);

  const headerHScrollRef = useRef<ScrollView>(null);
  const bodyHScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setColWidths((prev) => {
      const next = [...prev];
      while (next.length < selectedAssets.length) {
        next.push(Math.min(DEFAULT_COL_WIDTH, maxColWidth));
      }
      if (next.length > selectedAssets.length) next.length = selectedAssets.length;
      return next;
    });
  }, [selectedAssets.length, maxColWidth]);

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

  useEffect(() => {
    if (expandedSpecIndex !== null && expandedSpecIndex >= visibleSpecs.length) {
      setExpandedSpecIndex(null);
    }
  }, [expandedSpecIndex, visibleSpecs]);

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
        next[index] = Math.min(Math.max(MIN_COL_WIDTH, longest * 10 + 32), maxColWidth);
        return next;
      });
    },
    [maxColWidth, selectedAssets, visibleSpecs],
  );

  const resetLayout = useCallback(() => {
    setColWidths(selectedAssets.map(() => Math.min(DEFAULT_COL_WIDTH, maxColWidth)));
    setHiddenSpecKeys(new Set());
    setShowMode("all");
    setExpandedSpecIndex(null);
  }, [maxColWidth, selectedAssets]);

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
            minHeight: APP_BAR_HEIGHT,
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
  const totalAssetWidth =
    selectedAssets.reduce((sum, _, i) => sum + (colWidths[i] ?? DEFAULT_COL_WIDTH), 0) +
    emptySlots * DEFAULT_COL_WIDTH;

  const pickerAllowedType: CompareAssetType | undefined = picker
    ? selectedAssets.length
      ? (comparisonType ?? undefined)
      : undefined
    : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        {/* App bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            minHeight: APP_BAR_HEIGHT,
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

        {/* Table header */}
        <View style={{ flexDirection: "row", height: TABLE_HEADER_HEIGHT }}>
          <SpecColumnHeader onConfig={() => setConfigOpen(true)} />
          <ScrollView
            ref={headerHScrollRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: "row" }}
            style={{ flex: 1 }}
          >
            {selectedAssets.map((asset, index) => (
              <AssetColumnHeader
                key={asset.id}
                asset={asset}
                index={index}
                colWidth={colWidths[index] ?? DEFAULT_COL_WIDTH}
                onSelect={() => setPicker({ open: true, index, mode: "replace" })}
                onResize={(dx) => handleResize(index, dx)}
                onAutoSize={() => handleAutoSize(index)}
                onResizeStart={() => setResizing(true)}
                onResizeEnd={() => setResizing(false)}
              />
            ))}
            {emptySlots > 0
              ? Array.from({ length: emptySlots }).map((_, i) => {
                  const globalIndex = selectedAssets.length + i;
                  return (
                    <AssetColumnHeader
                      key={`empty-${globalIndex}`}
                      index={globalIndex}
                      colWidth={colWidths[globalIndex] ?? DEFAULT_COL_WIDTH}
                      onSelect={() => setPicker({ open: true, index: globalIndex, mode: "add" })}
                      onResize={() => {}}
                      onAutoSize={() => {}}
                    />
                  );
                })
              : null}
          </ScrollView>
        </View>

        {/* Table body */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => setExpandedSpecIndex(null)}
          scrollEnabled={!resizing}
          contentContainerStyle={{ flexGrow: 1 }}
          style={{ flex: 1 }}
        >
          <View style={{ flexDirection: "row" }}>
            <SpecColumnBody
              specs={visibleSpecs}
              onToggle={(i) => setExpandedSpecIndex(expandedSpecIndex === i ? null : i)}
            />
            <ScrollView
              ref={bodyHScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={!resizing}
              onScroll={(e) => syncHeaderScroll(e.nativeEvent.contentOffset.x)}
              scrollEventThrottle={16}
              contentContainerStyle={{ flexDirection: "row" }}
              style={{ flex: 1 }}
            >
              {selectedAssets.map((asset, index) => (
                <AssetColumnBody
                  key={asset.id}
                  asset={asset}
                  colWidth={colWidths[index] ?? DEFAULT_COL_WIDTH}
                  specs={visibleSpecs}
                  onResize={(dx) => handleResize(index, dx)}
                  onAutoSize={() => handleAutoSize(index)}
                  onResizeStart={() => setResizing(true)}
                  onResizeEnd={() => setResizing(false)}
                />
              ))}
              {emptySlots > 0
                ? Array.from({ length: emptySlots }).map((_, i) => {
                    const globalIndex = selectedAssets.length + i;
                    return (
                      <AssetColumnBody
                        key={`empty-${globalIndex}`}
                        colWidth={colWidths[globalIndex] ?? DEFAULT_COL_WIDTH}
                        specs={visibleSpecs}
                        onResize={() => {}}
                        onAutoSize={() => {}}
                      />
                    );
                  })
                : null}
              <AssetOverlay
                specs={visibleSpecs}
                expandedIndex={expandedSpecIndex}
                totalWidth={totalAssetWidth}
                onCollapse={() => setExpandedSpecIndex(null)}
              />
            </ScrollView>
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
