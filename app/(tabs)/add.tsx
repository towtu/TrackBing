import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Barcode,
  CaretLeft,
  ForkKnife,
  Info,
  MagnifyingGlass,
  Minus,
  Plus,
  X,
} from "phosphor-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet as RNStyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";
import { supabase } from "@/src/lib/supabase";
import { upsertDailySummary } from "@/src/lib/dailySummary";
import {
  loadGistFoods,
  loadRecentBarcodeFoods,
  searchAllFoods,
} from "@/src/lib/foodSearch";
import {
  calcMacros,
  getUnitsToDisplay,
  type FoodItem,
  type Macros,
  type Unit,
} from "@/src/lib/macros";
import { Colors } from "@/src/styles/colors";
import { useResponsive } from "@/src/hooks/useResponsive";

type FeedbackState = {
  type: SweetFeedbackType;
  title: string;
  message: string;
  autoDismissMs?: number;
  onClose?: () => void;
};

const FOOD_UNITS: Unit[] = ["g", "ml", "oz", "tsp", "tbsp", "cup", "serving"];

const isFoodUnit = (unit: unknown): unit is Unit =>
  typeof unit === "string" && FOOD_UNITS.includes(unit as Unit);

const barcodeFromFood = (food: FoodItem | null) => {
  const code = food?.code?.trim();
  if (!code || code === "scanned") return null;
  if (/^(personal|gist|usda)-/.test(code)) return null;
  if (!/^[A-Za-z0-9-]{4,64}$/.test(code)) return null;
  return code;
};

const createRecentBarcodeFood = (
  food: FoodItem,
  barcode: string,
  macros: Macros,
  servingSize: string,
  servingUnit: Unit
): FoodItem => ({
  code: barcode,
  product_name: food.product_name || "Scanned item",
  brands: `Recent serving - ${servingSize}${servingUnit}`,
  default_unit: "serving",
  serving_quantity: 1,
  serving_weight: 100,
  nutriments: {
    "energy-kcal_100g": macros.c,
    proteins_100g: macros.p,
    carbohydrates_100g: macros.cb,
    fat_100g: macros.f,
  },
});

export default function AddFoodPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isDesktop } = useResponsive();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [customFoods, setCustomFoods] = useState<FoodItem[]>([]);
  const [recentBarcodeFoods, setRecentBarcodeFoods] = useState<FoodItem[]>([]);

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [revealedBarcodeCode, setRevealedBarcodeCode] = useState<
    string | null
  >(null);

  const [inputWeight, setInputWeight] = useState("100");
  const [selectedUnit, setSelectedUnit] = useState<Unit>("g");

  useEffect(() => {
    let active = true;
    loadGistFoods().then((foods) => {
      if (active) setCustomFoods(foods);
    });
    loadRecentBarcodeFoods().then((foods) => {
      if (active) setRecentBarcodeFoods(foods);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (params.initialName) {
      const initialUnit = isFoodUnit(params.initialUnit)
        ? params.initialUnit
        : "g";
      setSelectedFood({
        code: (params.code as string) || "scanned",
        product_name: params.initialName as string,
        brands: (params.brand as string) || "Scanned",
        default_unit: initialUnit,
        nutriments: {
          "energy-kcal_100g": parseFloat(params.initialCal as string) || 0,
          proteins_100g: parseFloat(params.initialProt as string) || 0,
          carbohydrates_100g: parseFloat(params.initialCarbs as string) || 0,
          fat_100g: parseFloat(params.initialFat as string) || 0,
        },
      });

      setInputWeight((params.initialWeight as string) || "100");
      setSelectedUnit(initialUnit);

      router.setParams({
        code: "",
        initialName: "",
        initialWeight: "",
        initialCal: "",
        initialProt: "",
        initialCarbs: "",
        initialFat: "",
        brand: "",
        initialUnit: "",
      });
    }
  }, [params, router]);

  const suggestions = useMemo(() => {
    if (query.length < 2) return [];
    return customFoods
      .filter((f) =>
        f.product_name?.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 5);
  }, [query, customFoods]);

  const selectFood = (item: FoodItem) => {
    Keyboard.dismiss();
    setSelectedFood(item);
    setRevealedBarcodeCode(null);

    const nextUnit = isFoodUnit(item.default_unit) ? item.default_unit : "g";
    setSelectedUnit(nextUnit);

    if (item.serving_quantity) {
      setInputWeight(item.serving_quantity.toString());
    } else {
      setInputWeight(nextUnit === "g" || nextUnit === "ml" ? "100" : "1");
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    const all = await searchAllFoods(query);
    setResults(all);
    setLoading(false);
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (!text.trim()) setResults([]);
  };

  const macros = selectedFood
    ? calcMacros(selectedFood, parseFloat(inputWeight) || 0, selectedUnit)
    : { c: 0, p: 0, cb: 0, f: 0 };

  const adjustWeight = (amount: number) => {
    const current = parseFloat(inputWeight) || 0;
    const isWeight =
      selectedUnit === "g" || selectedUnit === "ml" || selectedUnit === "oz";
    const step = isWeight ? amount : Math.sign(amount) * 1;
    const next = Math.max(0, current + step);
    setInputWeight(next.toString());
  };

  const confirmAdd = async () => {
    if (!selectedFood || submitting) return;
    setSubmitting(true);
    const foodBarcode = barcodeFromFood(selectedFood);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { error } = await supabase.from("food_logs").insert([
        {
          user_id: user.id,
          name: selectedFood.product_name,
          calories: macros.c,
          protein: macros.p,
          carbs: macros.cb,
          fat: macros.f,
          serving_size: inputWeight,
          serving_unit: selectedUnit,
          barcode: foodBarcode,
        },
      ]);
      if (error) {
        setSelectedFood(null);
        setFeedback({
          type: "error",
          title: "Could not log food",
          message: error.message,
        });
      } else {
        upsertDailySummary();
        if (foodBarcode) {
          const recentFood = createRecentBarcodeFood(
            selectedFood,
            foodBarcode,
            macros,
            inputWeight,
            selectedUnit
          );
          setRecentBarcodeFoods((current) => [
            recentFood,
            ...current.filter((item) => item.code !== foodBarcode),
          ].slice(0, 8));
        }
        setSelectedFood(null);
        setFeedback({
          type: "success",
          title: "Logged!",
          message: "Added to your daily intake.",
          autoDismissMs: 1100,
          onClose: () => router.back(),
        });
      }
    }
    setSubmitting(false);
  };

  const closeFeedback = () => {
    const onClose = feedback?.onClose;
    setFeedback(null);
    onClose?.();
  };

  const displayList = results;

  const unitsToDisplay = getUnitsToDisplay(selectedFood ?? undefined);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.primary }}
      edges={["top"]}
    >
      <View style={[{ padding: 18, flex: 1, width: "100%" }, isDesktop ? { maxWidth: 1280, alignSelf: "center" } : { maxWidth: 520, alignSelf: "center" }]}>
        <View style={localStyles.header}>
          {!isDesktop && (
            <TouchableOpacity
              onPress={() => router.back()}
              style={localStyles.backButton}
            >
              <CaretLeft size={24} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
          )}
          <Text style={localStyles.headerTitle}>Find Food</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {!isDesktop && (
              <TouchableOpacity
                onPress={() => router.push("/my-foods")}
                style={localStyles.backButton}
              >
                <ForkKnife size={24} color={Colors.accent} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push("/create-food")}
              style={localStyles.backButton}
            >
              <Plus size={24} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
            {!isDesktop && (
              <TouchableOpacity
                onPress={() => router.push("/scan")}
                style={localStyles.backButton}
              >
                <Barcode size={24} color={Colors.accent} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={isDesktop ? { flexDirection: "row", flex: 1, gap: 24, marginTop: 16 } : { flex: 1 }}>
          <View style={isDesktop ? { flex: 1.2 } : { flex: 1 }}>
            <View style={localStyles.searchBox}>
              <MagnifyingGlass size={20} color={Colors.textSecondary} style={{ marginLeft: 15 }} />
              <TextInput
                style={localStyles.input}
                placeholder="Search food..."
                placeholderTextColor={Colors.textSecondary}
                value={query}
                onChangeText={handleQueryChange}
                onSubmitEditing={handleSearch}
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setQuery("");
                    setResults([]);
                  }}
                  style={{ marginRight: 15 }}
                >
                  <X size={18} color={Colors.textSecondary} weight="bold" />
                </TouchableOpacity>
              )}
            </View>

            {/* Gist suggestions preview + hint */}
            {!loading && results.length === 0 && suggestions.length > 0 && (
              <View style={{ marginBottom: 12, width: "100%" }}>
                {suggestions.map((item) => (
                  <TouchableOpacity
                    key={item.code}
                    style={[localStyles.itemCard, localStyles.suggestionItemCard]}
                    onPress={() => selectFood(item)}
                  >
                    <View style={localStyles.iconCircle}>
                      <Text style={{ fontSize: 18 }}>🥗</Text>
                    </View>
                    <View style={{ flex: 1, flexShrink: 1, marginLeft: 12 }}>
                      <Text style={localStyles.itemName} numberOfLines={2}>{item.product_name}</Text>
                      <Text style={localStyles.itemSub} numberOfLines={1} ellipsizeMode="tail">
                        Generic • {Math.round(item.nutriments?.["energy-kcal_100g"] || 0)} kcal
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
                <Text style={{ color: Colors.textSecondary, fontSize: 12, textAlign: "center", marginTop: 4, letterSpacing: 0.5 }}>
                  Press Enter to search all sources
                </Text>
              </View>
            )}

            {!loading &&
              results.length === 0 &&
              query.trim().length < 2 &&
              recentBarcodeFoods.length > 0 && (
                <View style={localStyles.recentSection}>
                  <View style={localStyles.sectionTitleRow}>
                    <Barcode size={16} color={Colors.accent} weight="bold" />
                    <Text style={localStyles.sectionTitle}>
                      Recent foods
                    </Text>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={localStyles.recentList}
                  >
                    {recentBarcodeFoods.map((item) => {
                      const isBarcodeRevealed =
                        revealedBarcodeCode === item.code;

                      return (
                        <View
                          key={item.code}
                          style={[
                            localStyles.recentCard,
                            selectedFood?.code === item.code &&
                              localStyles.recentCardActive,
                          ]}
                        >
                          <TouchableOpacity
                            activeOpacity={0.84}
                            style={localStyles.recentCardBody}
                            onPress={() => selectFood(item)}
                          >
                            <View style={localStyles.recentCardHeader}>
                              <Text
                                style={localStyles.recentName}
                                numberOfLines={2}
                              >
                                {item.product_name}
                              </Text>
                            </View>
                            <Text
                              style={localStyles.recentMeta}
                              numberOfLines={1}
                            >
                              {item.brands}
                            </Text>
                            <Text style={localStyles.recentKcal}>
                              {Math.round(
                                item.nutriments?.["energy-kcal_100g"] || 0
                              )}{" "}
                              kcal
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={
                              isBarcodeRevealed
                                ? `Hide barcode for ${item.product_name}`
                                : `Show barcode for ${item.product_name}`
                            }
                            accessibilityState={{ selected: isBarcodeRevealed }}
                            activeOpacity={0.8}
                            onPress={() =>
                              setRevealedBarcodeCode((current) =>
                                current === item.code ? null : item.code
                              )
                            }
                            style={[
                              localStyles.recentInfoButton,
                              isBarcodeRevealed &&
                                localStyles.recentInfoButtonActive,
                            ]}
                          >
                            <Info
                              size={15}
                              color={
                                isBarcodeRevealed
                                  ? Colors.primary
                                  : Colors.accent
                              }
                              weight="bold"
                            />
                          </TouchableOpacity>

                          {isBarcodeRevealed && (
                            <View style={localStyles.recentInfoRow}>
                              <Barcode
                                size={13}
                                color={Colors.textSecondary}
                                weight="bold"
                              />
                              <Text style={localStyles.recentInfoLabel}>
                                Barcode
                              </Text>
                              <Text
                                selectable
                                style={localStyles.recentBarcodeValue}
                                numberOfLines={1}
                              >
                                {item.code}
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

            {loading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={displayList}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => (
                  <View style={localStyles.itemRowContainer}>
                    <TouchableOpacity
                      style={[
                        localStyles.itemCard,
                        selectedFood?.code === item.code && isDesktop && { borderColor: Colors.accent, borderWidth: 1 }
                      ]}
                      onPress={() => selectFood(item)}
                    >
                      <View style={localStyles.iconCircle}>
                        <Text style={{ fontSize: 18 }}>
                          {item.brands === "My Food"
                            ? "🍪"
                            : item.brands === "Generic"
                              ? "🥗"
                              : item.brands === "USDA"
                                ? "🥩"
                                : "📦"}
                        </Text>
                      </View>
                      <View style={{ flex: 1, flexShrink: 1, marginLeft: 12 }}>
                        <Text style={localStyles.itemName} numberOfLines={2}>
                          {item.product_name}
                        </Text>
                        <Text style={localStyles.itemSub} numberOfLines={1} ellipsizeMode="tail">
                          {item.brands} •{" "}
                          {Math.round(item.nutriments?.["energy-kcal_100g"] || 0)}{" "}
                          kcal
                        </Text>
                      </View>
                      <View style={{ flexShrink: 0 }}>
                        <Plus size={20} color={Colors.accent} weight="bold" />
                      </View>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={
                  !loading && query.length > 2 ? (
                    <View style={{ alignItems: "center", marginTop: 30 }}>
                      <Text style={{ color: Colors.textSecondary, marginBottom: 15 }}>
                        No results for &quot;{query}&quot;
                      </Text>
                      <TouchableOpacity
                        style={localStyles.createBtn}
                        onPress={() => router.push("/create-food")}
                      >
                        <Plus size={20} color={Colors.accent} />
                        <Text style={{ color: Colors.text, fontWeight: "bold" }}>
                          Create &quot;{query}&quot;
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null
                }
              />
            )}
          </View>

          {isDesktop && (
            <View style={{ flex: 1, backgroundColor: Colors.secondary, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: Colors.border, minHeight: 450 }}>
              {selectedFood ? (
                <View>
                  <View style={localStyles.modalHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={localStyles.modalFoodName}>
                        {selectedFood.product_name}
                      </Text>
                      <Text style={{ color: Colors.textSecondary }}>{selectedFood.brands}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedFood(null)}
                      style={localStyles.closeBtn}
                    >
                      <X size={24} color="white" />
                    </TouchableOpacity>
                  </View>

                  <View style={localStyles.weightSection}>
                    <TouchableOpacity
                      onPress={() => adjustWeight(-10)}
                      style={localStyles.adjustBtn}
                    >
                      <Minus size={20} color="white" weight="bold" />
                    </TouchableOpacity>

                    <View style={localStyles.weightInputContainer}>
                      <TextInput
                        style={localStyles.weightInput}
                        keyboardType="numeric"
                        value={inputWeight}
                        onChangeText={(t) =>
                          setInputWeight(t.replace(/[^0-9.]/g, ""))
                        }
                        selectTextOnFocus
                      />

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={[{ marginTop: 8 }, localStyles.unitBar]}
                        contentContainerStyle={{ paddingHorizontal: 4 }}
                      >
                        {unitsToDisplay.map((u) => (
                          <TouchableOpacity
                            key={u}
                            onPress={() => setSelectedUnit(u)}
                            style={{
                              paddingHorizontal: 16,
                              paddingVertical: 10,
                              borderBottomWidth: 2,
                              borderBottomColor:
                                selectedUnit === u ? Colors.accent : "transparent",
                            }}
                          >
                            <Text
                              style={{
                                color:
                                  selectedUnit === u
                                    ? Colors.accent
                                    : Colors.textSecondary,
                                fontWeight: selectedUnit === u ? "700" : "500",
                                fontSize: 12,
                                textTransform: "uppercase",
                                letterSpacing: 1,
                              }}
                            >
                              {u}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>

                    <TouchableOpacity
                      onPress={() => adjustWeight(10)}
                      style={localStyles.adjustBtn}
                    >
                      <Plus size={20} color="white" weight="bold" />
                    </TouchableOpacity>
                  </View>

                  <View style={localStyles.bentoContainer}>
                    <View style={localStyles.bentoMain}>
                      <Text style={localStyles.bentoValue}>{macros.c}</Text>
                      <Text style={localStyles.bentoLabel}>CALORIES</Text>
                    </View>
                    <View style={localStyles.bentoGrid}>
                      <View style={localStyles.bentoSmall}>
                        <Text style={localStyles.bentoValueSmall}>{macros.p}g</Text>
                        <Text style={localStyles.bentoLabelSmall}>PROT</Text>
                      </View>
                      <View style={localStyles.bentoSmall}>
                        <Text style={localStyles.bentoValueSmall}>
                          {macros.cb}g
                        </Text>
                        <Text style={localStyles.bentoLabelSmall}>CARBS</Text>
                      </View>
                      <View style={localStyles.bentoSmall}>
                        <Text style={localStyles.bentoValueSmall}>{macros.f}g</Text>
                        <Text style={localStyles.bentoLabelSmall}>FAT</Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={localStyles.confirmBtn}
                    onPress={confirmAdd}
                    disabled={submitting}
                  >
                    <Text style={localStyles.confirmText}>
                      {submitting ? "Adding..." : "Log this meal"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 100 }}>
                  <Text style={{ color: Colors.textSecondary, fontSize: 16, textAlign: "center" }}>
                    Select a food item from the list to adjust serving size and log it to your day.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        <Modal visible={!isDesktop && !!selectedFood} transparent animationType="fade">
          <View style={localStyles.modalOverlay}>
            <View style={localStyles.modalContent}>
              <View style={localStyles.modalDragBar} />
              <View style={localStyles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.modalFoodName}>
                    {selectedFood?.product_name}
                  </Text>
                  <Text style={{ color: Colors.textSecondary }}>{selectedFood?.brands}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedFood(null)}
                  style={localStyles.closeBtn}
                >
                  <X size={24} color="white" />
                </TouchableOpacity>
              </View>

              <View style={localStyles.weightSection}>
                <TouchableOpacity
                  onPress={() => adjustWeight(-10)}
                  style={localStyles.adjustBtn}
                >
                  <Minus size={20} color="white" weight="bold" />
                </TouchableOpacity>

                <View style={localStyles.weightInputContainer}>
                  <TextInput
                    style={localStyles.weightInput}
                    keyboardType="numeric"
                    value={inputWeight}
                    onChangeText={(t) =>
                      setInputWeight(t.replace(/[^0-9.]/g, ""))
                    }
                    selectTextOnFocus
                  />

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={[{ marginTop: 8 }, localStyles.unitBar]}
                    contentContainerStyle={{ paddingHorizontal: 4 }}
                  >
                    {unitsToDisplay.map((u) => (
                      <TouchableOpacity
                        key={u}
                        onPress={() => setSelectedUnit(u)}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                          borderBottomWidth: 2,
                          borderBottomColor:
                            selectedUnit === u ? Colors.accent : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            color:
                              selectedUnit === u
                                ? Colors.accent
                                : Colors.textSecondary,
                            fontWeight: selectedUnit === u ? "700" : "500",
                            fontSize: 12,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          {u}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <TouchableOpacity
                  onPress={() => adjustWeight(10)}
                  style={localStyles.adjustBtn}
                >
                  <Plus size={20} color="white" weight="bold" />
                </TouchableOpacity>
              </View>

              <View style={localStyles.bentoContainer}>
                <View style={localStyles.bentoMain}>
                  <Text style={localStyles.bentoValue}>{macros.c}</Text>
                  <Text style={localStyles.bentoLabel}>CALORIES</Text>
                </View>
                <View style={localStyles.bentoGrid}>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>{macros.p}g</Text>
                    <Text style={localStyles.bentoLabelSmall}>PROT</Text>
                  </View>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>
                      {macros.cb}g
                    </Text>
                    <Text style={localStyles.bentoLabelSmall}>CARBS</Text>
                  </View>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>{macros.f}g</Text>
                    <Text style={localStyles.bentoLabelSmall}>FAT</Text>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={localStyles.confirmBtn}
                onPress={confirmAdd}
                disabled={submitting}
              >
                <Text style={localStyles.confirmText}>
                  {submitting ? "Adding..." : "Log this meal"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <SweetFeedback
          visible={!!feedback}
          type={feedback?.type}
          title={feedback?.title ?? ""}
          message={feedback?.message}
          autoDismissMs={feedback?.autoDismissMs}
          onClose={closeFeedback}
        />
      </View>
    </SafeAreaView>
  );
}

const localStyles = RNStyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  backButton: {
    padding: 9,
    backgroundColor: Colors.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  searchBox: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    borderRadius: 18,
    alignItems: "center",
    marginBottom: 16,
    height: 56,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  input: { flex: 1, color: Colors.text, paddingHorizontal: 12, fontSize: 16 },
  itemRowContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  itemCard: {
    flex: 1,
    backgroundColor: Colors.secondary,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  suggestionItemCard: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    alignSelf: "stretch",
    marginRight: 0,
    marginBottom: 8,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
    flexShrink: 0,
  },
  itemName: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: -0.1,
  },
  itemSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  recentSection: {
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
  },
  recentList: {
    paddingRight: 4,
    gap: 8,
  },
  recentCard: {
    width: 200,
    minHeight: 120,
    backgroundColor: Colors.secondary,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    position: "relative",
  },
  recentCardActive: {
    borderColor: Colors.accent,
  },
  recentCardBody: {
    minHeight: 84,
  },
  recentCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 0,
  },
  recentInfoButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  recentInfoButtonActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  recentName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "800",
    minHeight: 34,
    letterSpacing: 0,
    paddingRight: 32,
  },
  recentMeta: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 6,
  },
  recentKcal: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 8,
  },
  recentInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  recentInfoLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  recentBarcodeValue: {
    flex: 1,
    color: Colors.text,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
  },
  createBtn: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.secondary,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingBottom: 44,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    maxHeight: "92%",
  },
  modalDragBar: {
    width: 36,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 18,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  modalFoodName: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  closeBtn: {
    backgroundColor: Colors.inputBg,
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  weightSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 22,
  },
  adjustBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  weightInputContainer: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  weightInput: {
    color: Colors.accent,
    fontSize: 44,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0,
    width: "100%",
    maxWidth: 180,
  },
  unitBar: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 22,
    maxWidth: "100%",
  },
  bentoContainer: { flexDirection: "row", gap: 10, marginBottom: 22 },
  bentoMain: {
    flex: 1.2,
    backgroundColor: Colors.inputBg,
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bentoGrid: { flex: 1, gap: 8 },
  bentoSmall: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bentoValue: {
    color: Colors.accent,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -1,
  },
  bentoLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  bentoValueSmall: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  bentoLabelSmall: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  confirmBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: "center",
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  confirmText: {
    color: Colors.textOnAccent,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  deleteBtn: {
    backgroundColor: "rgba(239,68,68,0.12)",
    padding: 13,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    minWidth: 48,
  },

});
