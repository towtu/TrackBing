import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Barcode,
  CaretLeft,
  CheckCircle,
  Keyboard as KeyboardIcon,
  MagnifyingGlass,
  Minus,
  Pencil,
  Plus,
  Trash,
  X,
} from "phosphor-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
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
import { lookupBarcode, searchAllFoods } from "@/src/lib/foodSearch";
import WebBarcodeScanner from "@/src/components/WebBarcodeScanner";
import AndroidBarcodeScanner from "@/src/components/scan/AndroidBarcodeScanner";
import ManualEntrySheet from "@/src/components/scan/ManualEntrySheet";
import {
  calcMacros,
  defaultWeightForUnit,
  getUnitsToDisplay,
  recipeTotal,
  type FoodItem,
  type RecipeIngredient,
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

export default function CreateRecipePage() {
  const router = useRouter();
  const { isDesktop } = useResponsive();

  // When opened with an ?id= param we're editing an existing recipe rather
  // than creating a new one.
  const params = useLocalSearchParams();
  const editId = typeof params.id === "string" ? params.id : null;

  const [name, setName] = useState("");
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const notify = (
    title: string,
    message: string,
    type: SweetFeedbackType = "warning",
    onClose?: () => void,
    autoDismissMs?: number
  ) => setFeedback({ title, message, type, onClose, autoDismissMs });

  // ── SEARCH MODAL ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [searching, setSearching] = useState(false);

  // ── BARCODE SCAN MODAL ──
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");

  // ── INGREDIENT EDITOR MODAL ──
  // editingFood holds the macro source (a search result or an existing row).
  // editIndex === null means we're adding a new ingredient.
  const [editingFood, setEditingFood] = useState<FoodItem | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editWeight, setEditWeight] = useState("100");
  const [editUnit, setEditUnit] = useState<Unit>("g");

  const total = recipeTotal(ingredients);

  const handleSearch = async () => {
    if (!query.trim()) return;
    Keyboard.dismiss();
    setSearching(true);
    const res = await searchAllFoods(query);
    setResults(res);
    setSearching(false);
  };

  // Auto-suggest: search every source as the user types, debounced so we don't
  // fire a request per keystroke. Mirrors the Find Food screen's live feel.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let active = true;
    const t = setTimeout(async () => {
      const res = await searchAllFoods(q);
      if (active) {
        setResults(res);
        setSearching(false);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  // Editing: pull the existing recipe in once and seed the form.
  useEffect(() => {
    if (!editId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("recipes")
        .select("name, ingredients")
        .eq("id", editId)
        .single();
      if (active && data) {
        setName(data.name ?? "");
        setIngredients(
          Array.isArray(data.ingredients) ? data.ingredients : []
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [editId]);

  // Open the editor for a freshly picked search result.
  const pickResult = (item: FoodItem) => {
    const u = (item.default_unit as Unit) || "g";
    setEditingFood(item);
    setEditIndex(null);
    setEditUnit(u);
    setEditWeight(
      item.serving_quantity
        ? item.serving_quantity.toString()
        : defaultWeightForUnit(u)
    );
    setSearchOpen(false);
  };

  // Barcode scanning: resolve the code to a product, then drop it straight
  // into the ingredient editor — without leaving the recipe being built.
  const handleScannedBarcode = useCallback(
    async (code: string) => {
      if (scanBusy) return;
      setScanBusy(true);
      const result = await lookupBarcode(code);
      setScanOpen(false);
      setScanBusy(false);
      if (result.ok) {
        if (!result.hasNutrition) {
          notify(
            "No nutrition data",
            `Found "${result.food.product_name}", but the database has no calories or macros for it. Add it under My Foods to set those yourself.`,
            "warning"
          );
          return;
        }
        pickResult(result.food);
      } else if (result.reason === "unreachable") {
        notify(
          "Food database unavailable",
          "OpenFoodFacts didn't respond. Check your connection and try again in a moment.",
          "error"
        );
      } else {
        notify(
          "Not in OpenFoodFacts",
          "OpenFoodFacts doesn't have this barcode yet. Search by name, or add it under My Foods.",
          "warning"
        );
      }
    },
    [scanBusy]
  );

  // Manually typed barcode — same lookup path as a camera scan.
  const submitManualCode = () => {
    const code = manualCode.trim();
    if (!code) return;
    setManualOpen(false);
    setManualCode("");
    handleScannedBarcode(code);
  };

  // Open the editor for an ingredient already in the recipe.
  const editIngredient = (index: number) => {
    const ing = ingredients[index];
    setEditingFood({
      code: "ing-" + index,
      product_name: ing.name,
      brands: ing.brands,
      default_unit: ing.default_unit,
      serving_weight: ing.serving_weight,
      serving_quantity: ing.serving_quantity,
      cup_weight: ing.cup_weight,
      nutriments: ing.nutriments,
    });
    setEditIndex(index);
    setEditUnit(ing.unit);
    setEditWeight(ing.weight.toString());
  };

  const adjustWeight = (amount: number) => {
    const current = parseFloat(editWeight) || 0;
    const isWeight =
      editUnit === "g" || editUnit === "ml" || editUnit === "oz";
    const step = isWeight ? amount : Math.sign(amount) * 1;
    setEditWeight(Math.max(0, current + step).toString());
  };

  const commitEditor = () => {
    if (!editingFood) return;
    const ing: RecipeIngredient = {
      name: editingFood.product_name,
      brands: editingFood.brands,
      weight: parseFloat(editWeight) || 0,
      unit: editUnit,
      default_unit: editingFood.default_unit,
      serving_weight: editingFood.serving_weight,
      serving_quantity: editingFood.serving_quantity,
      cup_weight: editingFood.cup_weight,
      nutriments: editingFood.nutriments,
    };
    setIngredients((prev) => {
      if (editIndex === null) return [...prev, ing];
      const next = [...prev];
      next[editIndex] = ing;
      return next;
    });
    closeEditor();
  };

  const closeEditor = () => {
    setEditingFood(null);
    setEditIndex(null);
  };

  const removeIngredient = (index: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (submitting) return;
    if (!name.trim()) {
      return notify("Missing name", "Give your recipe a name.");
    }
    if (ingredients.length === 0) {
      return notify("No ingredients", "Add at least one ingredient.");
    }
    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return;
    }
    const { error } = editId
      ? await supabase
          .from("recipes")
          .update({ name: name.trim(), ingredients })
          .eq("id", editId)
      : await supabase
          .from("recipes")
          .insert([{ user_id: user.id, name: name.trim(), ingredients }]);
    setSubmitting(false);
    if (error) {
      notify("Could not save recipe", error.message, "error");
    } else {
      notify(
        "Saved!",
        editId ? "Recipe updated." : "Recipe saved.",
        "success",
        () => router.back(),
        1100
      );
    }
  };

  const closeFeedback = () => {
    const onClose = feedback?.onClose;
    setFeedback(null);
    onClose?.();
  };

  const editorMacros = editingFood
    ? calcMacros(editingFood, parseFloat(editWeight) || 0, editUnit)
    : { c: 0, p: 0, cb: 0, f: 0 };
  const unitsToDisplay = getUnitsToDisplay(editingFood ?? undefined);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.primary }}
      edges={["top"]}
    >
      <View
        style={[
          { padding: 18, flex: 1, width: "100%" },
          isDesktop
            ? { maxWidth: 760, alignSelf: "center" }
            : { maxWidth: 520, alignSelf: "center" },
        ]}
      >
        {/* ── HEADER ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
            <CaretLeft size={24} color={Colors.accent} weight="bold" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{editId ? "Edit Recipe" : "New Recipe"}</Text>
          <View style={{ width: 42 }} />
        </View>

        <FlatList
          data={ingredients}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(_, i) => "ing-" + i}
          ListHeaderComponent={
            <View>
              {/* Name */}
              <Text style={s.label}>Recipe Name</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. Chicken Adobo"
                placeholderTextColor="#666"
                value={name}
                onChangeText={setName}
              />

              {/* Running total */}
              <View style={s.totalCard}>
                <View>
                  <Text style={s.totalValue}>{total.c}</Text>
                  <Text style={s.totalLabel}>TOTAL CALORIES</Text>
                </View>
                <View style={s.totalMacros}>
                  <Text style={s.totalMacroText}>P {total.p}g</Text>
                  <Text style={s.totalMacroText}>C {total.cb}g</Text>
                  <Text style={s.totalMacroText}>F {total.f}g</Text>
                </View>
              </View>

              <View style={s.ingHeaderRow}>
                <Text style={s.label}>
                  Ingredients ({ingredients.length})
                </Text>
              </View>
            </View>
          }
          renderItem={({ item, index }) => {
            const m = calcMacros(item, item.weight, item.unit);
            return (
              <View style={s.ingRow}>
                <TouchableOpacity
                  style={s.ingCard}
                  onPress={() => editIngredient(index)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.ingName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={s.ingSub}>
                      {item.weight}
                      {item.unit} · {m.c} kcal · P{m.p} C{m.cb} F{m.f}
                    </Text>
                  </View>
                  <Pencil size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.ingDeleteBtn}
                  onPress={() => removeIngredient(index)}
                >
                  <Trash size={18} color="#FF4444" weight="bold" />
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={s.emptyHint}>
              No ingredients yet. Add foods and their amounts — the calories add
              up automatically.
            </Text>
          }
          ListFooterComponent={
            <TouchableOpacity
              style={s.addIngredientBtn}
              onPress={() => {
                setQuery("");
                setResults([]);
                setSearchOpen(true);
              }}
            >
              <Plus size={20} color={Colors.accent} weight="bold" />
              <Text style={s.addIngredientText}>Add ingredient</Text>
            </TouchableOpacity>
          }
        />

        {/* Save */}
        <TouchableOpacity
          style={[s.saveBtn, submitting && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="black" />
          ) : (
            <CheckCircle size={24} color="black" weight="fill" />
          )}
          <Text style={s.saveBtnText}>
            {submitting ? "Saving..." : "Save Recipe"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── SEARCH MODAL ── */}
      <Modal visible={searchOpen} animationType="slide">
        <SafeAreaView
          style={{ flex: 1, backgroundColor: Colors.primary }}
          edges={["top"]}
        >
          <View
            style={[
              { padding: 18, flex: 1, width: "100%" },
              isDesktop
                ? { maxWidth: 760, alignSelf: "center" }
                : { maxWidth: 520, alignSelf: "center" },
            ]}
          >
            <View style={s.header}>
              <Text style={s.headerTitle}>Add Ingredient</Text>
              <TouchableOpacity
                onPress={() => setSearchOpen(false)}
                style={s.iconBtn}
              >
                <X size={24} color="white" />
              </TouchableOpacity>
            </View>

            <View style={s.searchBox}>
              <MagnifyingGlass
                size={20}
                color={Colors.textSecondary}
                style={{ marginLeft: 15 }}
              />
              <TextInput
                style={s.searchInput}
                placeholder="Search food..."
                placeholderTextColor={Colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={handleSearch}
                autoFocus
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

            <TouchableOpacity
              style={s.scanBtn}
              onPress={() => {
                // Close the search modal first so the scanner is the only
                // modal on screen — nested modals break the camera and the
                // editor that should open afterwards on React Native Web.
                setSearchOpen(false);
                setScanBusy(false);
                setScanOpen(true);
              }}
            >
              <Barcode size={20} color={Colors.accent} weight="bold" />
              <Text style={s.scanBtnText}>Scan barcode</Text>
            </TouchableOpacity>

            {searching ? (
              <ActivityIndicator
                color={Colors.accent}
                style={{ marginTop: 20 }}
              />
            ) : (
              <FlatList
                data={results}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.resultCard}
                    onPress={() => pickResult(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.ingName} numberOfLines={2}>
                        {item.product_name}
                      </Text>
                      <Text style={s.ingSub} numberOfLines={1}>
                        {item.brands} ·{" "}
                        {Math.round(
                          item.nutriments?.["energy-kcal_100g"] || 0
                        )}{" "}
                        kcal
                      </Text>
                    </View>
                    <Plus size={20} color={Colors.accent} weight="bold" />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  query.trim().length >= 2 ? (
                    <Text style={s.emptyHint}>
                      No matches. Try another term, or create it under My Foods
                      first.
                    </Text>
                  ) : (
                    <Text style={s.emptyHint}>
                      Type at least 2 letters to search.
                    </Text>
                  )
                }
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── BARCODE SCAN MODAL ── */}
      <Modal visible={scanOpen} animationType="slide">
        <View style={{ flex: 1, backgroundColor: "black" }}>
          {Platform.OS === "web" ? (
            <WebBarcodeScanner
              onBarcodeScanned={handleScannedBarcode}
              active={scanOpen && !scanBusy}
            />
          ) : (
            <AndroidBarcodeScanner
              onBarcodeScanned={handleScannedBarcode}
              active={scanOpen && !scanBusy}
            />
          )}

          <View style={s.scanOverlay} pointerEvents="box-none">
            <View style={s.scanHeader}>
              <TouchableOpacity
                onPress={() => {
                  setScanOpen(false);
                  setSearchOpen(true);
                }}
                style={s.scanCloseBtn}
              >
                <X size={24} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  // Swap the camera for the manual entry sheet — single modal
                  // on screen at a time, same as the rest of this flow.
                  setScanOpen(false);
                  setManualCode("");
                  setManualOpen(true);
                }}
                style={s.scanCloseBtn}
              >
                <KeyboardIcon size={24} color="white" />
              </TouchableOpacity>
            </View>

            <View style={s.scanReticle}>
              {scanBusy && (
                <ActivityIndicator size="large" color={Colors.accent} />
              )}
            </View>

            <View style={s.scanFooter}>
              <Text style={s.scanHint}>
                {scanBusy ? "Looking up product..." : "Point at a barcode"}
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MANUAL BARCODE ENTRY ── */}
      <ManualEntrySheet
        visible={manualOpen}
        value={manualCode}
        onChange={setManualCode}
        onClose={() => {
          setManualOpen(false);
          setScanOpen(true);
        }}
        onSubmit={submitManualCode}
      />

      {/* ── INGREDIENT EDITOR MODAL ── */}
      <Modal visible={!!editingFood} transparent animationType="fade">
        <View style={s.editorOverlay}>
          <View style={s.editorContent}>
            <View style={s.modalDragBar} />
            <View style={s.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalFoodName}>{editingFood?.product_name}</Text>
                <Text style={{ color: Colors.textSecondary }}>
                  {editingFood?.brands}
                </Text>
              </View>
              <TouchableOpacity onPress={closeEditor} style={s.iconBtn}>
                <X size={24} color="white" />
              </TouchableOpacity>
            </View>

            <View style={s.weightSection}>
              <TouchableOpacity
                onPress={() => adjustWeight(-10)}
                style={s.adjustBtn}
              >
                <Minus size={20} color="white" weight="bold" />
              </TouchableOpacity>

              <View style={s.weightInputContainer}>
                <TextInput
                  style={s.weightInput}
                  keyboardType="numeric"
                  value={editWeight}
                  onChangeText={(t) => setEditWeight(t.replace(/[^0-9.]/g, ""))}
                  selectTextOnFocus
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={[{ marginTop: 8 }, s.unitBar]}
                  contentContainerStyle={{ paddingHorizontal: 4 }}
                >
                  {unitsToDisplay.map((u) => (
                    <TouchableOpacity
                      key={u}
                      onPress={() => setEditUnit(u)}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderBottomWidth: 2,
                        borderBottomColor:
                          editUnit === u ? Colors.accent : "transparent",
                      }}
                    >
                      <Text
                        style={{
                          color:
                            editUnit === u
                              ? Colors.accent
                              : Colors.textSecondary,
                          fontWeight: editUnit === u ? "700" : "500",
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
                style={s.adjustBtn}
              >
                <Plus size={20} color="white" weight="bold" />
              </TouchableOpacity>
            </View>

            <View style={s.bentoContainer}>
              <View style={s.bentoMain}>
                <Text style={s.bentoValue}>{editorMacros.c}</Text>
                <Text style={s.bentoLabel}>CALORIES</Text>
              </View>
              <View style={s.bentoGrid}>
                <View style={s.bentoSmall}>
                  <Text style={s.bentoValueSmall}>{editorMacros.p}g</Text>
                  <Text style={s.bentoLabelSmall}>PROT</Text>
                </View>
                <View style={s.bentoSmall}>
                  <Text style={s.bentoValueSmall}>{editorMacros.cb}g</Text>
                  <Text style={s.bentoLabelSmall}>CARBS</Text>
                </View>
                <View style={s.bentoSmall}>
                  <Text style={s.bentoValueSmall}>{editorMacros.f}g</Text>
                  <Text style={s.bentoLabelSmall}>FAT</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity style={s.confirmBtn} onPress={commitEditor}>
              <Text style={s.confirmText}>
                {editIndex === null ? "Add to recipe" : "Update ingredient"}
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  iconBtn: {
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
  label: {
    color: "#888",
    marginBottom: 8,
    fontSize: 12,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  input: {
    backgroundColor: Colors.secondary,
    color: "white",
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#333",
  },
  totalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
  },
  totalValue: {
    color: Colors.accent,
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -1,
  },
  totalLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  totalMacros: { alignItems: "flex-end", gap: 4 },
  totalMacroText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  ingHeaderRow: { marginBottom: 8 },
  ingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  ingCard: {
    flex: 1,
    backgroundColor: Colors.secondary,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginRight: 10,
  },
  ingName: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 15,
  },
  ingSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  ingDeleteBtn: {
    backgroundColor: "rgba(239,68,68,0.12)",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  emptyHint: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 24,
    lineHeight: 20,
  },
  addIngredientBtn: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
    marginTop: 4,
    marginBottom: 16,
  },
  addIngredientText: {
    color: Colors.text,
    fontWeight: "bold",
    fontSize: 15,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    borderRadius: 24,
    marginTop: 4,
    gap: 8,
  },
  saveBtnText: {
    fontWeight: "bold",
    fontSize: 16,
    color: "black",
  },

  // ── BARCODE SCAN ──
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    marginBottom: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  scanBtnText: {
    color: Colors.accent,
    fontWeight: "bold",
    fontSize: 15,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  scanHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  scanCloseBtn: {
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 15,
  },
  scanReticle: {
    alignSelf: "center",
    width: 260,
    height: 180,
    borderWidth: 3,
    borderColor: Colors.accent,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFooter: {
    paddingBottom: 60,
    alignItems: "center",
  },
  scanHint: {
    color: "white",
    opacity: 0.85,
    fontSize: 14,
    fontWeight: "500",
  },

  // ── SEARCH MODAL ──
  searchBox: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    borderRadius: 18,
    alignItems: "center",
    marginBottom: 16,
    height: 56,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  resultCard: {
    backgroundColor: Colors.secondary,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 10,
  },

  // ── EDITOR MODAL ──
  editorOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "flex-end",
  },
  editorContent: {
    backgroundColor: Colors.secondary,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingBottom: 44,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    width: "100%",
    maxWidth: 520,
    maxHeight: "92%",
    alignSelf: "center",
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
  bentoValueSmall: { color: Colors.text, fontSize: 15, fontWeight: "700" },
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
  },
  confirmText: {
    color: Colors.textOnAccent,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

});
