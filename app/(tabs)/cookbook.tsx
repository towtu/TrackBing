import { useFocusEffect, useRouter } from "expo-router";
import {
  BookOpen,
  CaretLeft,
  CheckCircle,
  MagnifyingGlass,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash,
  X,
} from "phosphor-react-native";
import React, { useCallback, useState } from "react";
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
import { supabase } from "@/src/lib/supabase";
import { upsertDailySummary } from "@/src/lib/dailySummary";
import {
  calcMacros,
  recipeTotal,
  type RecipeIngredient,
} from "@/src/lib/macros";
import { Colors } from "@/src/styles/colors";
import { useResponsive } from "@/src/hooks/useResponsive";

type Recipe = {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
};

// Quick portion fractions of the whole recipe.
const PORTION_PRESETS = [
  { label: "1", value: 1 },
  { label: "½", value: 0.5 },
  { label: "⅓", value: 1 / 3 },
  { label: "¼", value: 0.25 },
];

export default function CookbookPage() {
  const router = useRouter();
  const { isDesktop } = useResponsive();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── LOG MODAL STATE ──
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [workingIngredients, setWorkingIngredients] = useState<
    RecipeIngredient[]
  >([]);
  const [adjustMode, setAdjustMode] = useState(false);
  // Portion of the whole recipe being logged: 1 = the entire recipe.
  const [portion, setPortion] = useState(1);
  const [customPortion, setCustomPortion] = useState("");
  const [logSuccess, setLogSuccess] = useState(false);

  // ── DELETE MODAL STATE ──
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletingRecipe, setDeletingRecipe] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const fetchRecipes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("recipes")
      .select("*")
      .order("created_at", { ascending: false });
    const formatted: Recipe[] =
      data?.map((r) => ({
        id: r.id,
        name: r.name,
        ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
      })) || [];
    setRecipes(formatted);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      fetchRecipes();
    }, [])
  );

  const filteredRecipes =
    filterQuery.length >= 2
      ? recipes.filter((r) =>
          r.name?.toLowerCase().includes(filterQuery.toLowerCase())
        )
      : recipes;

  // ── OPEN LOG MODAL ──
  const openRecipe = (recipe: Recipe) => {
    Keyboard.dismiss();
    setSelectedRecipe(recipe);
    // Deep-clone ingredients so log-time weight edits stay one-off.
    setWorkingIngredients(recipe.ingredients.map((ing) => ({ ...ing })));
    setAdjustMode(false);
    setPortion(1);
    setCustomPortion("");
  };

  // Open the builder in edit mode for this recipe.
  const editRecipe = (recipe: Recipe) => {
    router.push({ pathname: "/create-recipe", params: { id: recipe.id } });
  };

  const updateIngredientWeight = (index: number, text: string) => {
    const value = parseFloat(text.replace(/[^0-9.]/g, "")) || 0;
    setWorkingIngredients((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], weight: value };
      return next;
    });
  };

  // Full recipe total, then scaled to the portion actually being logged.
  const baseTotal = recipeTotal(workingIngredients);
  const loggedTotal = {
    c: Math.round(baseTotal.c * portion),
    p: Math.round(baseTotal.p * portion),
    cb: Math.round(baseTotal.cb * portion),
    f: Math.round(baseTotal.f * portion),
  };

  const confirmLog = async () => {
    if (!selectedRecipe || submitting) return;
    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("food_logs").insert([
        {
          user_id: user.id,
          name: selectedRecipe.name,
          calories: loggedTotal.c,
          protein: loggedTotal.p,
          carbs: loggedTotal.cb,
          fat: loggedTotal.f,
          serving_size: parseFloat(portion.toFixed(2)).toString(),
          serving_unit: "recipe",
        },
      ]);
      upsertDailySummary();
      setSelectedRecipe(null);
      setLogSuccess(true);
    }
    setSubmitting(false);
  };

  // ── DELETE ──
  const handleDeletePress = (recipe: Recipe) => {
    setDeletingRecipe({ id: recipe.id, name: recipe.name });
    setDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!deletingRecipe) return;
    const { error } = await supabase
      .from("recipes")
      .delete()
      .eq("id", deletingRecipe.id);
    if (error) {
      alert("Error: " + error.message);
    } else {
      setRecipes((prev) => prev.filter((r) => r.id !== deletingRecipe.id));
    }
    setDeleteModal(false);
    setDeletingRecipe(null);
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.primary }}
      edges={["top"]}
    >
      <View
        style={[
          { padding: 18, flex: 1, width: "100%" },
          isDesktop
            ? { maxWidth: 1200, alignSelf: "center" }
            : { maxWidth: 520, alignSelf: "center" },
        ]}
      >
        {/* ── HEADER ── */}
        <View style={localStyles.header}>
          {!isDesktop && (
            <TouchableOpacity
              onPress={() => router.back()}
              style={localStyles.backButton}
            >
              <CaretLeft size={24} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
          )}
          <Text style={localStyles.headerTitle}>My Cookbook</Text>
          <TouchableOpacity
            onPress={() => router.push("/create-recipe")}
            style={localStyles.backButton}
          >
            <Plus size={24} color={Colors.accent} weight="bold" />
          </TouchableOpacity>
        </View>

        {/* ── SEARCH / FILTER BAR ── */}
        <View style={localStyles.searchBox}>
          <MagnifyingGlass
            size={20}
            color={Colors.textSecondary}
            style={{ marginLeft: 15 }}
          />
          <TextInput
            style={localStyles.input}
            placeholder="Filter your recipes..."
            placeholderTextColor={Colors.textSecondary}
            value={filterQuery}
            onChangeText={setFilterQuery}
          />
          {filterQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setFilterQuery("")}
              style={{ marginRight: 15 }}
            >
              <X size={18} color={Colors.textSecondary} weight="bold" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── COUNT BADGE ── */}
        <View style={localStyles.countRow}>
          <View style={localStyles.countBadge}>
            <BookOpen size={14} color={Colors.accent} weight="fill" />
            <Text style={localStyles.countText}>
              {filteredRecipes.length}{" "}
              {filteredRecipes.length === 1 ? "recipe" : "recipes"}
            </Text>
          </View>
        </View>

        {/* ── RECIPE LIST ── */}
        {loading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            key={isDesktop ? "desktop" : "mobile"}
            numColumns={isDesktop ? 2 : 1}
            columnWrapperStyle={isDesktop ? { gap: 16 } : undefined}
            data={filteredRecipes}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const total = recipeTotal(item.ingredients);
              return (
                <View
                  style={[
                    localStyles.itemRowContainer,
                    isDesktop && { flex: 1, marginBottom: 16, marginRight: 0 },
                  ]}
                >
                  <TouchableOpacity
                    style={localStyles.itemCard}
                    onPress={() => openRecipe(item)}
                  >
                    <View style={localStyles.iconCircle}>
                      <Text style={{ fontSize: 18 }}>🍲</Text>
                    </View>
                    <View style={{ flex: 1, flexShrink: 1, marginLeft: 12 }}>
                      <Text style={localStyles.itemName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={localStyles.itemSub}>
                        {item.ingredients.length}{" "}
                        {item.ingredients.length === 1
                          ? "ingredient"
                          : "ingredients"}{" "}
                        · {total.c} kcal · P:{total.p}g · C:{total.cb}g · F:
                        {total.f}g
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={localStyles.editBtn}
                    onPress={() => editRecipe(item)}
                  >
                    <Pencil size={20} color={Colors.accent} weight="bold" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={localStyles.deleteBtn}
                    onPress={() => handleDeletePress(item)}
                  >
                    <Trash size={20} color="#FF4444" weight="bold" />
                  </TouchableOpacity>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={localStyles.emptyState}>
                <View style={localStyles.emptyIconBox}>
                  <BookOpen
                    size={36}
                    color={Colors.textSecondary}
                    weight="duotone"
                  />
                </View>
                <Text style={localStyles.emptyTitle}>
                  {filterQuery.length >= 2
                    ? `No recipes matching "${filterQuery}"`
                    : "No saved recipes yet"}
                </Text>
                <Text style={localStyles.emptySubtext}>
                  {filterQuery.length >= 2
                    ? "Try a different search term"
                    : "Combine ingredients into a recipe — the calories add up automatically."}
                </Text>
                {filterQuery.length < 2 && (
                  <TouchableOpacity
                    style={localStyles.emptyCreateBtn}
                    onPress={() => router.push("/create-recipe")}
                  >
                    <Plus size={20} color={Colors.accent} />
                    <Text
                      style={{
                        color: Colors.text,
                        fontWeight: "bold",
                        fontSize: 14,
                      }}
                    >
                      Create Recipe
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            }
          />
        )}

        {/* ── LOG RECIPE MODAL ── */}
        <Modal visible={!!selectedRecipe} transparent animationType="fade">
          <View style={localStyles.modalOverlay}>
            <View style={localStyles.modalContent}>
              <View style={localStyles.modalDragBar} />
              <View style={localStyles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.modalFoodName}>
                    {selectedRecipe?.name}
                  </Text>
                  <Text style={{ color: Colors.textSecondary }}>
                    {adjustMode
                      ? "Tweak the amounts for this log"
                      : `${workingIngredients.length} ingredients`}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedRecipe(null)}
                  style={localStyles.closeBtn}
                >
                  <X size={24} color="white" />
                </TouchableOpacity>
              </View>

              {/* Total */}
              <View style={localStyles.bentoContainer}>
                <View style={localStyles.bentoMain}>
                  <Text style={localStyles.bentoValue}>{loggedTotal.c}</Text>
                  <Text style={localStyles.bentoLabel}>CALORIES</Text>
                </View>
                <View style={localStyles.bentoGrid}>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>
                      {loggedTotal.p}g
                    </Text>
                    <Text style={localStyles.bentoLabelSmall}>PROT</Text>
                  </View>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>
                      {loggedTotal.cb}g
                    </Text>
                    <Text style={localStyles.bentoLabelSmall}>CARBS</Text>
                  </View>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>
                      {loggedTotal.f}g
                    </Text>
                    <Text style={localStyles.bentoLabelSmall}>FAT</Text>
                  </View>
                </View>
              </View>

              {/* Portion */}
              <View style={localStyles.portionBlock}>
                <View style={localStyles.portionHeader}>
                  <Text style={localStyles.portionTitle}>How much?</Text>
                  {portion !== 1 && (
                    <Text style={localStyles.portionHint}>
                      whole recipe = {baseTotal.c} kcal
                    </Text>
                  )}
                </View>
                <View style={localStyles.portionRow}>
                  {PORTION_PRESETS.map((p) => {
                    const active =
                      !customPortion && Math.abs(portion - p.value) < 0.001;
                    return (
                      <TouchableOpacity
                        key={p.label}
                        style={[
                          localStyles.portionChip,
                          active && localStyles.portionChipActive,
                        ]}
                        onPress={() => {
                          setCustomPortion("");
                          setPortion(p.value);
                        }}
                      >
                        <Text
                          style={[
                            localStyles.portionChipText,
                            active && localStyles.portionChipTextActive,
                          ]}
                        >
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TextInput
                    style={[
                      localStyles.portionCustom,
                      !!customPortion && localStyles.portionChipActive,
                    ]}
                    keyboardType="numeric"
                    placeholder="0.0"
                    placeholderTextColor={Colors.textSecondary}
                    value={customPortion}
                    onChangeText={(t) => {
                      const cleaned = t.replace(/[^0-9.]/g, "");
                      setCustomPortion(cleaned);
                      const v = parseFloat(cleaned);
                      if (!isNaN(v) && v > 0) setPortion(v);
                    }}
                    selectTextOnFocus
                  />
                  <Text style={localStyles.portionTimes}>×</Text>
                </View>
              </View>

              {/* Ingredient list */}
              <ScrollView
                style={{ maxHeight: 240, marginBottom: 18 }}
                keyboardShouldPersistTaps="handled"
              >
                {workingIngredients.map((ing, index) => {
                  const m = calcMacros(ing, ing.weight, ing.unit);
                  return (
                    <View key={index} style={localStyles.ingRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={localStyles.ingName} numberOfLines={1}>
                          {ing.name}
                        </Text>
                        <Text style={localStyles.ingSub}>
                          {m.c} kcal · P{m.p} C{m.cb} F{m.f}
                        </Text>
                      </View>
                      {adjustMode ? (
                        <View style={localStyles.weightEditRow}>
                          <TextInput
                            style={localStyles.weightEditInput}
                            keyboardType="numeric"
                            value={ing.weight.toString()}
                            onChangeText={(t) =>
                              updateIngredientWeight(index, t)
                            }
                            selectTextOnFocus
                          />
                          <Text style={localStyles.weightEditUnit}>
                            {ing.unit}
                          </Text>
                        </View>
                      ) : (
                        <Text style={localStyles.ingAmount}>
                          {ing.weight}
                          {ing.unit}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              {/* Actions */}
              {adjustMode ? (
                <TouchableOpacity
                  style={localStyles.confirmBtn}
                  onPress={confirmLog}
                  disabled={submitting}
                >
                  <Text style={localStyles.confirmText}>
                    {submitting ? "Logging..." : "Log adjusted recipe"}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={{ gap: 12 }}>
                  <TouchableOpacity
                    style={localStyles.confirmBtn}
                    onPress={confirmLog}
                    disabled={submitting}
                  >
                    <Text style={localStyles.confirmText}>
                      {submitting ? "Logging..." : "Log as-is"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={localStyles.adjustToggleBtn}
                    onPress={() => setAdjustMode(true)}
                  >
                    <SlidersHorizontal size={18} color={Colors.text} />
                    <Text style={localStyles.adjustToggleText}>
                      Adjust amounts
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* ── DELETE CONFIRMATION MODAL ── */}
        <Modal visible={deleteModal} transparent animationType="fade">
          <View style={localStyles.deleteOverlay}>
            <TouchableOpacity
              style={RNStyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => {
                setDeleteModal(false);
                setDeletingRecipe(null);
              }}
            />
            <View style={localStyles.glassModal}>
              <View style={localStyles.glassModalDrag} />
              <View style={localStyles.deleteModalIcon}>
                <Trash size={32} color={Colors.error} weight="fill" />
              </View>
              <Text style={localStyles.deleteModalTitle}>Remove Recipe</Text>
              <Text style={localStyles.deleteModalSubtitle}>
                Are you sure you want to delete &quot;{deletingRecipe?.name}
                &quot; from your cookbook?
              </Text>
              <View style={localStyles.deleteModalBtnRow}>
                <TouchableOpacity
                  style={localStyles.btnKeep}
                  onPress={() => {
                    setDeleteModal(false);
                    setDeletingRecipe(null);
                  }}
                >
                  <Text style={localStyles.btnKeepText}>Keep it</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={localStyles.btnConfirmDelete}
                  onPress={confirmDelete}
                >
                  <Trash size={18} color={Colors.white} weight="bold" />
                  <Text style={localStyles.btnConfirmDeleteText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── LOG SUCCESS MODAL ── */}
        <Modal visible={logSuccess} transparent animationType="fade">
          <View style={localStyles.deleteOverlay}>
            <TouchableOpacity
              style={RNStyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setLogSuccess(false)}
            />
            <View style={localStyles.glassModal}>
              <View style={localStyles.glassModalDrag} />
              <View style={localStyles.successIcon}>
                <CheckCircle size={36} color={Colors.accent} weight="fill" />
              </View>
              <Text style={localStyles.deleteModalTitle}>Logged!</Text>
              <Text style={localStyles.deleteModalSubtitle}>
                Added to today&apos;s food log.
              </Text>
              <TouchableOpacity
                style={localStyles.successBtn}
                onPress={() => setLogSuccess(false)}
              >
                <Text style={localStyles.btnConfirmDeleteText}>Done</Text>
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
    marginBottom: 12,
    height: 56,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  input: {
    flex: 1,
    color: Colors.text,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  countRow: {
    flexDirection: "row",
    marginBottom: 14,
  },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  countText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
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
  itemSub: {
    color: Colors.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
  editBtn: {
    backgroundColor: Colors.surface,
    padding: 13,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
    minWidth: 48,
    marginRight: 8,
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
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 32,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    marginTop: 32,
  },
  emptyIconBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
    textAlign: "center",
  },
  emptySubtext: {
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 18,
  },
  emptyCreateBtn: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // ── LOG MODAL ──
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
    width: "100%",
    maxWidth: 520,
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
  closeBtn: {
    backgroundColor: Colors.inputBg,
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ingName: {
    color: Colors.text,
    fontWeight: "600",
    fontSize: 14,
  },
  ingSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  ingAmount: {
    color: Colors.accent,
    fontWeight: "800",
    fontSize: 14,
  },
  weightEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  weightEditInput: {
    color: Colors.accent,
    fontSize: 16,
    fontWeight: "800",
    minWidth: 44,
    textAlign: "right",
    paddingVertical: 4,
  },
  weightEditUnit: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
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
  adjustToggleBtn: {
    flexDirection: "row",
    backgroundColor: Colors.inputBg,
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  adjustToggleText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },

  // ── PORTION ──
  portionBlock: {
    marginBottom: 20,
  },
  portionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  portionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  portionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  portionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  portionChip: {
    width: 48,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  portionChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  portionChipText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  portionChipTextActive: {
    color: Colors.textOnAccent,
  },
  portionCustom: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    paddingHorizontal: 8,
  },
  portionTimes: {
    color: Colors.textSecondary,
    fontSize: 18,
    fontWeight: "800",
  },

  // ── SUCCESS MODAL ──
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(150,255,150,0.12)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  successBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: "center",
  },

  // ── DELETE MODAL ──
  deleteOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  glassModal: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    backgroundColor: "rgba(18, 18, 20, 0.8)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 48,
  },
  glassModalDrag: {
    width: 48,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 24,
  },
  deleteModalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(239,68,68,0.15)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  deleteModalTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  deleteModalSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 32,
  },
  deleteModalBtnRow: {
    flexDirection: "row",
    gap: 12,
  },
  btnKeep: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: "center",
  },
  btnKeepText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  btnConfirmDelete: {
    flex: 1,
    backgroundColor: Colors.error,
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    elevation: 6,
  },
  btnConfirmDeleteText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "800",
  },
});
