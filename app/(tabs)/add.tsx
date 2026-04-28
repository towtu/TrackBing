import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Barcode,
  CaretLeft,
  CheckCircle,
  MagnifyingGlass,
  Minus,
  Plus,
  X,
} from "phosphor-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import { supabase } from "@/src/lib/supabase";
import { upsertDailySummary } from "@/src/lib/dailySummary";
import { searchUSDA } from "@/src/lib/usda";
import { Colors } from "@/src/styles/colors";

const CUSTOM_DB_URL =
  "https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json";

export default function AddFoodPage() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [customFoods, setCustomFoods] = useState<any[]>([]);

  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastScale = useRef(new Animated.Value(0.8)).current;

  const [selectedFood, setSelectedFood] = useState<any | null>(null);

  const [inputWeight, setInputWeight] = useState("100");
  const [selectedUnit, setSelectedUnit] = useState<
    "g" | "ml" | "oz" | "tsp" | "tbsp" | "cup" | "serving"
  >("g");

  useEffect(() => {
    const fetchGist = async () => {
      try {
        const response = await fetch(CUSTOM_DB_URL);
        const data = await response.json();
        const formatted = data.map((f: any) => ({
          code: "gist-" + f.name,
          product_name: f.name,
          brands: "Generic",
          default_unit: f.unit || "g",
          serving_weight: f.serving_weight,
          cup_weight: f.cup_weight,
          nutriments: {
            "energy-kcal_100g": f.c,
            proteins_100g: f.p,
            carbohydrates_100g: f.cb,
            fat_100g: f.f,
          },
        }));
        setCustomFoods(formatted);
      } catch (e) {
        console.error("Gist failed", e);
      }
    };
    fetchGist();
  }, []);

  useEffect(() => {
    if (params.initialName) {
      setSelectedFood({
        code: (params.code as string) || "scanned",
        product_name: params.initialName as string,
        brands: (params.brand as string) || "Scanned",
        default_unit: (params.initialUnit as string) || "g",
        nutriments: {
          "energy-kcal_100g": parseFloat(params.initialCal as string) || 0,
          proteins_100g: parseFloat(params.initialProt as string) || 0,
          carbohydrates_100g: parseFloat(params.initialCarbs as string) || 0,
          fat_100g: parseFloat(params.initialFat as string) || 0,
        },
      });

      setInputWeight((params.initialWeight as string) || "100");
      setSelectedUnit((params.initialUnit as any) || "g");

      router.setParams({
        initialName: "",
        initialWeight: "",
        brand: "",
        initialUnit: "",
      });
    }
  }, [params]);

  const suggestions = useMemo(() => {
    if (query.length < 2) return [];
    return customFoods
      .filter((f) =>
        f.product_name?.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 5);
  }, [query, customFoods]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);

    const [usdaResults, offResults] = await Promise.all([
      searchUSDA(query),
      (async () => {
        try {
          const offRes = await fetch(
            `https://us.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=10&lc=en`,
          );
          const offData = await offRes.json();
          return (
            offData.products?.map((item: any) => ({
              code: item.code || Math.random().toString(),
              product_name: item.product_name || "Unknown Food",
              brands: item.brands || "Packaged",
              default_unit: item.product_quantity_unit === "ml" ? "ml" : "g",
              serving_quantity: item.serving_quantity || 100,
              nutriments: {
                "energy-kcal_100g": item.nutriments?.["energy-kcal_100g"] || 0,
                proteins_100g: item.nutriments?.proteins_100g || 0,
                carbohydrates_100g: item.nutriments?.carbohydrates_100g || 0,
                fat_100g: item.nutriments?.fat_100g || 0,
              },
            })) || []
          );
        } catch (e) {
          console.warn(e);
          return [];
        }
      })(),
    ]);

    const gistMatches = customFoods.filter((f) =>
      f.product_name?.toLowerCase().includes(query.toLowerCase())
    );
    setResults([...gistMatches, ...usdaResults, ...offResults]);
    setLoading(false);
  };

  const calculateMacros = () => {
    if (!selectedFood) return { c: 0, p: 0, cb: 0, f: 0 };

    const inputAmount = parseFloat(inputWeight) || 0;
    let ratio = 1;

    if (selectedUnit === "serving") {
      const sw = selectedFood.serving_weight || selectedFood.serving_quantity;
      ratio = sw ? (inputAmount * sw) / 100 : inputAmount;
    } else if (selectedUnit === "cup") {
      ratio = selectedFood.cup_weight
        ? (inputAmount * selectedFood.cup_weight) / 100
        : (inputAmount * 236.588) / 100;
    } else if (selectedUnit === "tbsp") {
      ratio = selectedFood.cup_weight
        ? (inputAmount * (selectedFood.cup_weight / 16)) / 100
        : (inputAmount * 14.7868) / 100;
    } else if (selectedUnit === "tsp") {
      ratio = selectedFood.cup_weight
        ? (inputAmount * (selectedFood.cup_weight / 48)) / 100
        : (inputAmount * 4.92892) / 100;
    } else {
      let weightInGrams = inputAmount;
      if (selectedUnit === "oz") weightInGrams *= 28.3495;
      ratio = weightInGrams / 100;
    }

    const n = selectedFood.nutriments;

    return {
      c: Math.round((n?.["energy-kcal_100g"] || 0) * ratio),
      p: Math.round((n?.proteins_100g || 0) * ratio),
      cb: Math.round((n?.carbohydrates_100g || 0) * ratio),
      f: Math.round((n?.fat_100g || 0) * ratio),
    };
  };

  const macros = calculateMacros();

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
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("food_logs").insert([
        {
          user_id: user.id,
          name: selectedFood.product_name,
          calories: macros.c,
          protein: macros.p,
          carbs: macros.cb,
          fat: macros.f,
          serving_size: inputWeight,
          serving_unit: selectedUnit,
        },
      ]);
      upsertDailySummary();
      setSelectedFood(null);
      setShowToast(true);
      toastOpacity.setValue(0);
      toastScale.setValue(0.8);
      Animated.parallel([
        Animated.spring(toastScale, { toValue: 1, tension: 200, friction: 8, useNativeDriver: true }),
        Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(toastScale, { toValue: 0.8, duration: 300, useNativeDriver: true }),
        ]).start(() => {
          setShowToast(false);
          router.back();
        });
      }, 1200);
    }
    setSubmitting(false);
  };

  const displayList = results;

  const isLiquid = selectedFood?.default_unit === "ml";
  const hasServing = !!(selectedFood?.serving_weight || selectedFood?.serving_quantity);
  const baseUnits: string[] = isLiquid
    ? ["ml", "tsp", "tbsp", "cup"]
    : ["g", "oz", "tsp", "tbsp", "cup"];
  const unitsToDisplay = hasServing ? [...baseUnits, "serving"] : baseUnits;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.primary }}
      edges={["top"]}
    >
      <View style={{ padding: 18, flex: 1, maxWidth: 520, alignSelf: "center", width: "100%" }}>
        <View style={localStyles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={localStyles.backButton}
          >
            <CaretLeft size={24} color={Colors.accent} weight="bold" />
          </TouchableOpacity>
          <Text style={localStyles.headerTitle}>Find Food</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={() => router.push("/create-food")}
              style={localStyles.backButton}
            >
              <Plus size={24} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/scan")}
              style={localStyles.backButton}
            >
              <Barcode size={24} color={Colors.accent} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={localStyles.searchBox}>
          <MagnifyingGlass size={20} color={Colors.textSecondary} style={{ marginLeft: 15 }} />
          <TextInput
            style={localStyles.input}
            placeholder="Search food..."
            placeholderTextColor={Colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
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
                style={[localStyles.itemCard, { flex: 0, alignSelf: "stretch", marginRight: 0, marginBottom: 8 }]}
                onPress={() => {
                  setSelectedFood(item);
                  setSelectedUnit(item.default_unit === "ml" ? "ml" : "g");
                  setInputWeight(item.serving_quantity ? item.serving_quantity.toString() : "100");
                }}
              >
                <View style={localStyles.iconCircle}>
                  <Text style={{ fontSize: 18 }}>🥗</Text>
                </View>
                <View style={{ flex: 1, flexShrink: 1, marginLeft: 12, minWidth: 0 }}>
                  <Text style={localStyles.itemName} numberOfLines={1}>{item.product_name}</Text>
                  <Text style={localStyles.itemSub}>
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
                  style={localStyles.itemCard}
                  onPress={() => {
                    Keyboard.dismiss();
                    setSelectedFood(item);
                    if (
                      item.default_unit &&
                      [
                        "g",
                        "ml",
                        "oz",
                        "tsp",
                        "tbsp",
                        "cup",
                        "serving",
                      ].includes(item.default_unit)
                    ) {
                      setSelectedUnit(item.default_unit as any);

                      if (item.serving_quantity) {
                        setInputWeight(item.serving_quantity.toString());
                      } else {
                        setInputWeight(
                          item.default_unit === "g" ||
                            item.default_unit === "ml"
                            ? "100"
                            : "1",
                        );
                      }
                    } else {
                      setSelectedUnit("g");
                      setInputWeight(
                        item.serving_quantity
                          ? item.serving_quantity.toString()
                          : "100",
                      );
                    }
                  }}
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
                  <View style={{ flex: 1, flexShrink: 1, marginLeft: 12, minWidth: 0 }}>
                    <Text style={localStyles.itemName} numberOfLines={1}>
                      {item.product_name}
                    </Text>
                    <Text style={localStyles.itemSub}>
                      {item.brands} •{" "}
                      {Math.round(item.nutriments?.["energy-kcal_100g"] || 0)}{" "}
                      kcal
                    </Text>
                  </View>
                  {true && (
                    <Plus size={20} color={Colors.accent} weight="bold" />
                  )}
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              !loading && query.length > 2 ? (
                <View style={{ alignItems: "center", marginTop: 30 }}>
                  <Text style={{ color: Colors.textSecondary, marginBottom: 15 }}>
                    No results for "{query}"
                  </Text>
                  <TouchableOpacity
                    style={localStyles.createBtn}
                    onPress={() => router.push("/create-food")}
                  >
                    <Plus size={20} color={Colors.accent} />
                    <Text style={{ color: Colors.text, fontWeight: "bold" }}>
                      Create "{query}"
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null
            }
          />
        )}

        <Modal visible={!!selectedFood} transparent animationType="fade">
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
                        onPress={() => setSelectedUnit(u as any)}
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

        {/* ── SUCCESS TOAST ── */}
        {showToast && (
          <Animated.View
            style={[
              localStyles.toastOverlay,
              { opacity: toastOpacity },
            ]}
          >
            <Animated.View
              style={[
                localStyles.toastCard,
                { transform: [{ scale: toastScale }] },
              ]}
            >
              <View style={localStyles.toastIconWrap}>
                <CheckCircle size={40} color={Colors.success} weight="fill" />
              </View>
              <Text style={localStyles.toastTitle}>Logged!</Text>
              <Text style={localStyles.toastSubtitle}>Added to your daily intake</Text>
            </Animated.View>
          </Animated.View>
        )}
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
    marginRight: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
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
  },
  itemName: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: -0.1,
  },
  itemSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
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
    justifyContent: "center",
    gap: 20,
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
  weightInputContainer: { alignItems: "center" },
  weightInput: {
    color: Colors.accent,
    fontSize: 52,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -2,
  },
  unitBar: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 22,
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

  // ── SUCCESS TOAST ──
  toastOverlay: {
    ...RNStyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  toastCard: {
    backgroundColor: Colors.surface,
    borderRadius: 28,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: Colors.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
    width: 200,
  },
  toastIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  toastTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  toastSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
});
