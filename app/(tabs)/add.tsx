import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Barcode,
  CaretLeft,
  Cookie,
  MagnifyingGlass,
  Minus,
  Plus,
  Trash,
  X,
} from "phosphor-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  StyleSheet as RNStyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../src/lib/supabase";
import { Colors } from "../../src/styles/colors";
import { ProductResult } from "../../src/types";

const CUSTOM_DB_URL =
  "https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json";

export default function AddFoodPage() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [customFoods, setCustomFoods] = useState<ProductResult[]>([]);
  const [personalFoods, setPersonalFoods] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<"search" | "my_foods">("search");

  const [selectedFood, setSelectedFood] = useState<ProductResult | null>(null);

  // ✅ NEW: Unit Selection State
  const [inputWeight, setInputWeight] = useState("100");
  const [selectedUnit, setSelectedUnit] = useState<"g" | "ml" | "oz">("g");

  useEffect(() => {
    const fetchGist = async () => {
      try {
        const response = await fetch(CUSTOM_DB_URL);
        const data = await response.json();
        const formatted = data.map((f: any) => ({
          code: "gist-" + f.name,
          product_name: f.name,
          brands: "Generic",
          default_unit: f.unit || "g", // Read default unit from JSON
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

  const fetchMyFoods = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("personal_foods")
      .select("*")
      .order("created_at", { ascending: false });
    const formatted =
      data?.map((f) => ({
        code: "personal-" + f.id,
        product_name: f.name,
        brands: "My Food",
        default_unit: f.default_unit || "g", // Read default unit from Database
        nutriments: {
          "energy-kcal_100g": f.calories,
          proteins_100g: f.protein,
          carbohydrates_100g: f.carbs,
          fat_100g: f.fat,
        },
        original_id: f.id,
      })) || [];
    setPersonalFoods(formatted);
    setLoading(false);
  };

  useEffect(() => {
    if (params.initialName) {
      setSelectedFood({
        code: (params.code as string) || "scanned",
        product_name: params.initialName as string,
        brands: "Scanned",
        nutriments: {
          "energy-kcal_100g": parseFloat(params.initialCal as string) || 0,
          proteins_100g: parseFloat(params.initialProt as string) || 0,
          carbohydrates_100g: parseFloat(params.initialCarbs as string) || 0,
          fat_100g: parseFloat(params.initialFat as string) || 0,
        },
      });
      setInputWeight("100");
      setSelectedUnit("g");
      router.setParams({ initialName: "" });
    }
  }, [params]);

  const toggleMyFoods = () => {
    if (viewMode === "my_foods") {
      setViewMode("search");
      setResults([]);
      setQuery("");
    } else {
      setViewMode("my_foods");
      setQuery("");
      fetchMyFoods();
    }
  };

  const handleDelete = async (item: any) => {
    if (!item.code.startsWith("personal-")) {
      alert("You can only delete foods you created.");
      return;
    }
    const deleteId = item.original_id;

    if (Platform.OS === "web") {
      if (confirm(`Are you sure you want to delete "${item.product_name}"?`)) {
        performDeletePersonal(deleteId, item.code);
      }
      return;
    }

    Alert.alert(
      "Delete Custom Food?",
      `Are you sure you want to delete "${item.product_name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => performDeletePersonal(deleteId, item.code),
        },
      ],
    );
  };

  const performDeletePersonal = async (id: string, code: string) => {
    const { error } = await supabase
      .from("personal_foods")
      .delete()
      .eq("id", id);
    if (error) {
      alert("Error: " + error.message);
    } else {
      setPersonalFoods((prev) => prev.filter((f) => f.code !== code));
      setResults((prev) => prev.filter((f) => f.code !== code));
    }
  };

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
    setViewMode("search");

    const { data: pData } = await supabase
      .from("personal_foods")
      .select("*")
      .ilike("name", `%${query}%`);

    const pResults =
      pData?.map((f) => ({
        code: "personal-" + f.id,
        product_name: f.name,
        brands: "My Food",
        default_unit: f.default_unit || "g",
        nutriments: {
          "energy-kcal_100g": f.calories,
          proteins_100g: f.protein,
          carbohydrates_100g: f.carbs,
          fat_100g: f.fat,
        },
        original_id: f.id,
      })) || [];

    let offResults: ProductResult[] = [];
    try {
      const offRes = await fetch(
        `https://us.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=10&lc=en`,
      );
      const offData = await offRes.json();
      offResults =
        offData.products?.map((item: any) => ({
          code: item.code || Math.random().toString(),
          product_name: item.product_name || "Unknown Food",
          brands: item.brands || "Packaged",
          nutriments: {
            "energy-kcal_100g": item.nutriments?.["energy-kcal_100g"] || 0,
            proteins_100g: item.nutriments?.proteins_100g || 0,
            carbohydrates_100g: item.nutriments?.carbohydrates_100g || 0,
            fat_100g: item.nutriments?.fat_100g || 0,
          },
        })) || [];
    } catch (e) {
      console.warn(e);
    }

    setResults([...pResults, ...suggestions, ...offResults]);
    setLoading(false);
  };

  // ✅ UPDATED: Calculation Logic for OZ
  const calculateMacros = () => {
    if (!selectedFood) return { c: 0, p: 0, cb: 0, f: 0 };

    let weightInGrams = parseFloat(inputWeight) || 0;

    // Convert Ounces to Grams for correct calculation
    if (selectedUnit === "oz") {
      weightInGrams = weightInGrams * 28.3495;
    }
    // ml is treated as 1:1 with grams for calorie density estimation

    const ratio = weightInGrams / 100;
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
    const next = Math.max(0, current + amount);
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
          serving_size: inputWeight, // Save just the number (e.g. 12)
          serving_unit: selectedUnit, // ✅ Save the unit (e.g. "oz")
        },
      ]);
      Alert.alert("Success", "Added to your log!");
      setSelectedFood(null);
      router.back();
    }
    setSubmitting(false);
  };

  const displayList =
    viewMode === "my_foods"
      ? personalFoods
      : results.length > 0
        ? results
        : suggestions;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.primary }}
      edges={["top"]}
    >
      <View style={{ padding: 20, flex: 1 }}>
        <View style={localStyles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={localStyles.backButton}
          >
            <CaretLeft size={24} color={Colors.accent} weight="bold" />
          </TouchableOpacity>
          <Text style={localStyles.headerTitle}>
            {viewMode === "my_foods" ? "My Cookbook" : "Find Food"}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={toggleMyFoods}
              style={[
                localStyles.backButton,
                viewMode === "my_foods" && { backgroundColor: Colors.accent },
              ]}
            >
              <Cookie
                size={24}
                color={viewMode === "my_foods" ? "black" : Colors.accent}
                weight="bold"
              />
            </TouchableOpacity>
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
          <MagnifyingGlass size={20} color="#666" style={{ marginLeft: 15 }} />
          <TextInput
            style={localStyles.input}
            placeholder={
              viewMode === "my_foods"
                ? "Browsing your foods..."
                : "Search food..."
            }
            placeholderTextColor="#666"
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              if (viewMode === "my_foods") setViewMode("search");
            }}
            onSubmitEditing={handleSearch}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
              style={{ marginRight: 15 }}
            >
              <X size={18} color="#666" weight="bold" />
            </TouchableOpacity>
          )}
        </View>

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
                    // ✅ AUTO-SELECT UNIT: Automatically switch to ml or oz if defined
                    if (item.default_unit === "ml") setSelectedUnit("ml");
                    else if (item.default_unit === "oz") setSelectedUnit("oz");
                    else setSelectedUnit("g");
                  }}
                >
                  <View style={localStyles.iconCircle}>
                    <Text style={{ fontSize: 18 }}>
                      {item.brands === "My Food"
                        ? "🍪"
                        : item.brands === "Generic"
                          ? "🥗"
                          : "📦"}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={localStyles.itemName} numberOfLines={1}>
                      {item.product_name}
                    </Text>
                    <Text style={localStyles.itemSub}>
                      {item.brands} •{" "}
                      {Math.round(item.nutriments?.["energy-kcal_100g"] || 0)}{" "}
                      kcal
                    </Text>
                  </View>
                  {viewMode !== "my_foods" && (
                    <Plus size={20} color={Colors.accent} weight="bold" />
                  )}
                </TouchableOpacity>
                {viewMode === "my_foods" && (
                  <TouchableOpacity
                    style={localStyles.deleteBtn}
                    onPress={() => handleDelete(item)}
                  >
                    <Trash size={22} color="#FF4444" weight="bold" />
                  </TouchableOpacity>
                )}
              </View>
            )}
            ListEmptyComponent={
              !loading && query.length > 2 && viewMode === "search" ? (
                <View style={{ alignItems: "center", marginTop: 30 }}>
                  <Text style={{ color: "#888", marginBottom: 15 }}>
                    No results for "{query}"
                  </Text>
                  <TouchableOpacity
                    style={localStyles.createBtn}
                    onPress={() => router.push("/create-food")}
                  >
                    <Plus size={20} color={Colors.accent} />
                    <Text style={{ color: "white", fontWeight: "bold" }}>
                      Create "{query}"
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : viewMode === "my_foods" ? (
                <Text
                  style={{ color: "#666", textAlign: "center", marginTop: 30 }}
                >
                  You haven't created any foods yet.
                </Text>
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
                  <Text style={{ color: "#888" }}>{selectedFood?.brands}</Text>
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
                    onChangeText={setInputWeight}
                    selectTextOnFocus
                  />

                  {/* ✅ UNIT TOGGLE BUTTONS */}
                  <View style={{ flexDirection: "row", gap: 5, marginTop: 5 }}>
                    {["g", "ml", "oz"].map((u) => (
                      <TouchableOpacity
                        key={u}
                        onPress={() => setSelectedUnit(u as any)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 10,
                          backgroundColor:
                            selectedUnit === u ? Colors.accent : "#333",
                        }}
                      >
                        <Text
                          style={{
                            color: selectedUnit === u ? "black" : "#888",
                            fontWeight: "bold",
                            fontSize: 14,
                          }}
                        >
                          {u}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
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
      </View>
    </SafeAreaView>
  );
}

const localStyles = RNStyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  backButton: { padding: 8, backgroundColor: "#1A1A1A", borderRadius: 12 },
  headerTitle: { color: "white", fontSize: 20, fontWeight: "bold" },
  searchBox: {
    flexDirection: "row",
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 20,
    height: 55,
    borderWidth: 1,
    borderColor: "#333",
  },
  input: { flex: 1, color: "white", paddingHorizontal: 10, fontSize: 16 },
  itemRowContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  itemCard: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    padding: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#262626",
    marginRight: 10,
  },
  iconCircle: {
    width: 45,
    height: 45,
    borderRadius: 22,
    backgroundColor: "#262626",
    alignItems: "center",
    justifyContent: "center",
  },
  itemName: { color: "white", fontWeight: "700", fontSize: 16 },
  itemSub: { color: "#666", fontSize: 12, marginTop: 2 },
  createBtn: {
    flexDirection: "row",
    backgroundColor: "#333",
    padding: 15,
    borderRadius: 20,
    alignItems: "center",
    gap: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#121212",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 25,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  modalDragBar: {
    width: 40,
    height: 4,
    backgroundColor: "#333",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 30,
  },
  modalFoodName: { color: "white", fontSize: 22, fontWeight: "800" },
  closeBtn: { backgroundColor: "#262626", padding: 10, borderRadius: 12 },
  weightSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginBottom: 35,
  },
  adjustBtn: {
    width: 45,
    height: 45,
    borderRadius: 15,
    backgroundColor: "#1A1A1A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  weightInputContainer: { alignItems: "center" },
  weightInput: {
    color: Colors.accent,
    fontSize: 48,
    fontWeight: "900",
    textAlign: "center",
  },
  bentoContainer: { flexDirection: "row", gap: 12, marginBottom: 35 },
  bentoMain: {
    flex: 1.2,
    backgroundColor: "#1A1A1A",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#262626",
  },
  bentoGrid: { flex: 1, gap: 8 },
  bentoSmall: {
    flex: 1,
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    paddingHorizontal: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#262626",
  },
  bentoValue: { color: Colors.accent, fontSize: 32, fontWeight: "900" },
  bentoLabel: { color: "#666", fontSize: 10, fontWeight: "bold" },
  bentoValueSmall: { color: "white", fontSize: 16, fontWeight: "bold" },
  bentoLabelSmall: { color: "#666", fontSize: 10, fontWeight: "bold" },
  confirmBtn: {
    backgroundColor: Colors.accent,
    padding: 20,
    borderRadius: 20,
    alignItems: "center",
  },
  confirmText: { color: "black", fontSize: 18, fontWeight: "900" },
  deleteBtn: {
    backgroundColor: "#330000",
    padding: 14,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#550000",
    minWidth: 50,
  },
});
