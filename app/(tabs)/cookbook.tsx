import { useFocusEffect, useRouter } from "expo-router";
import {
  BookOpen,
  CaretLeft,
  MagnifyingGlass,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash,
  X,
} from "@/src/components/icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { upsertDailySummary } from "@/src/lib/dailySummary";
import { createFoodAccountGuard } from "@/src/lib/foodAccountGuard";
import { emitFoodLogChanged } from "@/src/lib/foodLogEvents";
import { parseRecipePortion, validateRecipe } from "@/src/lib/foodValidation";
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

type FeedbackState = {
  type: SweetFeedbackType;
  title: string;
  message: string;
  autoDismissMs?: number;
};

export default function CookbookPage() {
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const accountRef = useRef<ReturnType<typeof createFoodAccountGuard> | null>(null);
  const loadVersion = useRef(0);
  const mutationInFlight = useRef(false);
  useEffect(() => {
    const guard = createFoodAccountGuard();
    accountRef.current = guard;
    return () => { guard.dispose(); accountRef.current = null; };
  }, []);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── LOG MODAL STATE ──
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [workingIngredients, setWorkingIngredients] = useState<
    RecipeIngredient[]
  >([]);
  const [adjustMode, setAdjustMode] = useState(false);
  const [ingredientAmounts, setIngredientAmounts] = useState<Record<number, string>>({});
  // Portion of the whole recipe being logged: 1 = the entire recipe.
  const [portion, setPortion] = useState(1);
  const [customPortion, setCustomPortion] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  // ── DELETE MODAL STATE ──
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletingRecipe, setDeletingRecipe] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const fetchRecipes = async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError(false);
    const guard = accountRef.current;
    const writer = await guard?.authorize();
    if (!writer?.isActive()) {
      if (version === loadVersion.current && guard?.isActive()) {
        setLoadError(true);
        setLoading(false);
      }
      return;
    }
    const { data, error } = await writer.client
      .from("recipes")
      .select("*")
      .eq("user_id", writer.userId)
      .order("created_at", { ascending: false });
    if (!writer.isActive() || version !== loadVersion.current) return;
    if (error) { setLoadError(true); setLoading(false); return; }
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
    setReviewError(null);
    // Deep-clone ingredients so log-time weight edits stay one-off.
    setWorkingIngredients(recipe.ingredients.map((ing) => ({ ...ing })));
    setAdjustMode(false);
    setIngredientAmounts({});
    setPortion(1);
    setCustomPortion("");
  };

  // Open the builder in edit mode for this recipe.
  const editRecipe = (recipe: Recipe) => {
    router.push({ pathname: "/create-recipe", params: { id: recipe.id } });
  };

  const updateIngredientWeight = (index: number, text: string) => {
    // Preserve invalid input as an invalid preview; never turn 1.2.3 into 1.2.
    const value = Number(text);
    setIngredientAmounts(prev => ({ ...prev, [index]: text }));
    setReviewError(null);
    setWorkingIngredients((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], weight: value };
      return next;
    });
  };

  // Full recipe total, then scaled to the portion actually being logged.
  const baseTotal = recipeTotal(workingIngredients);
  const checkedPortion = parseRecipePortion(customPortion || String(portion));
  const previewPortion = checkedPortion ?? 0;
  const loggedTotal = {
    c: Math.round(baseTotal.c * previewPortion),
    p: Math.round(baseTotal.p * previewPortion),
    cb: Math.round(baseTotal.cb * previewPortion),
    f: Math.round(baseTotal.f * previewPortion),
  };
  const recipeValidationError = selectedRecipe ? validateRecipe(selectedRecipe.name, workingIngredients) : null;
  const previewValid = checkedPortion !== null && !recipeValidationError && Object.values(loggedTotal).every(Number.isFinite);

  const confirmLog = async () => {
    if (!selectedRecipe || mutationInFlight.current) return;
    const validationError = recipeValidationError;
    if (checkedPortion === null || validationError || !Object.values(loggedTotal).every(value => Number.isFinite(value) && value >= 0 && value <= 100000)) {
      setReviewError(validationError ?? "Enter a portion greater than 0 and no more than 100 whole recipes.");
      return;
    }
    const guard = accountRef.current;
    mutationInFlight.current = true;
    setSubmitting(true);
    setReviewError(null);
    try {
      const writer = await guard?.authorize();
      if (!writer?.isActive()) {
        if (guard?.isActive()) setReviewError("Your sign-in couldn't be verified. Your reviewed recipe is still here.");
        return;
      }
      const { error } = await writer.client.from("food_logs").insert([
        {
          user_id: writer.userId,
          name: selectedRecipe.name,
          calories: loggedTotal.c,
          protein: loggedTotal.p,
          carbs: loggedTotal.cb,
          fat: loggedTotal.f,
          serving_size: String(checkedPortion),
          serving_unit: "recipe",
        },
      ]);
      if (!writer.isActive()) return;
      if (error) {
        setReviewError("The save couldn't be confirmed. Your reviewed recipe is still here. Check your connection and diary before retrying.");
      } else {
        setSelectedRecipe(null);
        setFeedback({
          type: "success",
          title: "Logged!",
          message: "Added to today's food log.",
          autoDismissMs: 1100,
        });
        // A totals/refresh failure cannot turn a confirmed insert into a failed save.
        try { emitFoodLogChanged(); } catch { console.warn("The food view could not refresh. The recipe remains saved."); }
        void upsertDailySummary().catch(() => console.warn("Daily totals could not refresh. The recipe remains saved."));
      }
    } catch {
      if (guard?.isActive()) setReviewError("The save couldn't be confirmed. Check your connection and diary before retrying.");
    } finally {
      mutationInFlight.current = false;
      if (guard?.isActive()) setSubmitting(false);
    }
  };

  // ── DELETE ──
  const handleDeletePress = (recipe: Recipe) => {
    setDeletingRecipe({ id: recipe.id, name: recipe.name });
    setDeleteModal(true);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deletingRecipe || mutationInFlight.current) return;
    const guard = accountRef.current;
    mutationInFlight.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const writer = await guard?.authorize();
      if (!writer?.isActive()) {
        if (guard?.isActive()) setDeleteError("Your sign-in couldn't be verified. Try again in a moment.");
        return;
      }
      const { error } = await writer.client.from("recipes").delete()
        .eq("id", deletingRecipe.id).eq("user_id", writer.userId);
      if (!writer.isActive()) return;
      if (error) {
        setDeleteError("The removal couldn't be confirmed. Check your connection and try again.");
        return;
      }
      setRecipes(prev => prev.filter(recipe => recipe.id !== deletingRecipe.id));
      setDeleteModal(false);
      setDeletingRecipe(null);
    } catch {
      if (guard?.isActive()) setDeleteError("The removal couldn't be confirmed. Check your connection and try again.");
    } finally {
      mutationInFlight.current = false;
      if (guard?.isActive()) setDeleting(false);
    }
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
            ? { maxWidth: 1280, alignSelf: "center" }
            : { maxWidth: 520, alignSelf: "center" },
        ]}
      >
        {/* ── HEADER ── */}
        <View style={localStyles.header}>
          {!isDesktop && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              style={localStyles.backButton}
            >
              <CaretLeft size={24} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
          )}
          <Text style={localStyles.headerTitle}>My Cookbook</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Create a recipe"
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
            accessibilityLabel="Filter saved recipes"
            maxLength={160}
            style={localStyles.input}
            placeholder="Filter your recipes..."
            placeholderTextColor={Colors.textSecondary}
            value={filterQuery}
            onChangeText={setFilterQuery}
          />
          {filterQuery.length > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Clear recipe filter"
              onPress={() => setFilterQuery("")}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <X size={18} color={Colors.textSecondary} weight="bold" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── COUNT BADGE ── */}
        {!loading && !loadError && <View style={localStyles.countRow}>
          <View style={localStyles.countBadge}>
            <BookOpen size={14} color={Colors.accent} weight="fill" />
            <Text style={localStyles.countText}>
              {filteredRecipes.length}{" "}
              {filteredRecipes.length === 1 ? "recipe" : "recipes"}
            </Text>
          </View>
        </View>}

        {/* ── RECIPE LIST ── */}
        {loading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : loadError ? (
          <View style={localStyles.emptyState}>
            <Text accessibilityRole="alert" style={localStyles.emptyTitle}>Your recipes couldn’t load.</Text>
            <Text style={localStyles.emptySubtext}>Check your connection and try again.</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry recipes" style={localStyles.emptyCreateBtn} onPress={fetchRecipes}>
              <Text style={{ color: Colors.accent, fontWeight: "600" }}>Try again</Text>
            </TouchableOpacity>
          </View>
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
                    accessibilityRole="button"
                    accessibilityLabel={`Review ${item.name}`}
                    style={localStyles.itemCard}
                    onPress={() => openRecipe(item)}
                  >
                    <View style={localStyles.iconCircle}>
                      <BookOpen size={20} color={Colors.accent} />
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
                        · {total.c} kcal
                      </Text>
                      <Text style={localStyles.itemSub}>
                        Protein {total.p} g · Carbs {total.cb} g · Fat {total.f} g
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <View style={localStyles.recipeActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.name}`}
                    style={localStyles.editBtn}
                    onPress={() => editRecipe(item)}
                  >
                    <Pencil size={20} color={Colors.accent} weight="bold" />
                    <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name}`}
                    style={localStyles.deleteBtn}
                    onPress={() => handleDeletePress(item)}
                  >
                    <Trash size={20} color={Colors.error} weight="bold" />
                    <Text style={{ color: Colors.error, fontSize: 13 }}>Remove</Text>
                  </TouchableOpacity>
                  </View>
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
                    accessibilityRole="button"
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
        <Modal visible={!!selectedRecipe} transparent animationType="fade" onRequestClose={() => { if (!submitting) setSelectedRecipe(null); }}>
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
                  accessibilityRole="button"
                  accessibilityLabel="Close recipe review"
                  disabled={submitting}
                  onPress={() => setSelectedRecipe(null)}
                  style={localStyles.closeBtn}
                >
                  <X size={24} color="white" />
                </TouchableOpacity>
              </View>

              {/* Total */}
              <View style={localStyles.bentoContainer}>
                <View style={localStyles.bentoMain}>
                  <Text style={localStyles.bentoValue}>{previewValid ? loggedTotal.c : "—"}</Text>
                  <Text style={localStyles.bentoLabel}>Calories</Text>
                </View>
                <View style={localStyles.bentoGrid}>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>
                      {previewValid ? `${loggedTotal.p} g` : "—"}
                    </Text>
                    <Text style={localStyles.bentoLabelSmall}>Protein</Text>
                  </View>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>
                      {previewValid ? `${loggedTotal.cb} g` : "—"}
                    </Text>
                    <Text style={localStyles.bentoLabelSmall}>Carbs</Text>
                  </View>
                  <View style={localStyles.bentoSmall}>
                    <Text style={localStyles.bentoValueSmall}>
                      {previewValid ? `${loggedTotal.f} g` : "—"}
                    </Text>
                    <Text style={localStyles.bentoLabelSmall}>Fat</Text>
                  </View>
                </View>
              </View>

              {/* Portion */}
              <View style={localStyles.portionBlock}>
                <View style={localStyles.portionHeader}>
                  <Text style={localStyles.portionTitle}>How much?</Text>
                  {checkedPortion !== 1 && (
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
                        accessibilityRole="button"
                        accessibilityLabel={`Recipe portion ${p.label}`}
                        accessibilityState={{ selected: active, disabled: submitting }}
                        disabled={submitting}
                        key={p.label}
                        style={[
                          localStyles.portionChip,
                          active && localStyles.portionChipActive,
                        ]}
                        onPress={() => {
                          setReviewError(null);
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
                    accessibilityLabel="Custom recipe portion"
                    aria-invalid={checkedPortion === null}
                    editable={!submitting}
                    maxLength={20}
                    style={[
                      localStyles.portionCustom,
                      !!customPortion && { borderColor: Colors.accent },
                    ]}
                    keyboardType="numeric"
                    placeholder="0.0"
                    placeholderTextColor={Colors.textSecondary}
                    value={customPortion}
                    onChangeText={text => { setCustomPortion(text); setReviewError(null); }}
                    selectTextOnFocus
                  />
                  <Text style={localStyles.portionTimes}>×</Text>
                </View>
                {checkedPortion === null && <Text accessibilityRole="alert" style={{ color: Colors.error, marginTop: 8, fontSize: 13 }}>Enter a portion greater than 0 and no more than 100 whole recipes.</Text>}
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
                          {Number.isFinite(ing.weight) && ing.weight > 0
                            ? `${m.c} kcal · Protein ${m.p} g · Carbs ${m.cb} g · Fat ${m.f} g`
                            : "Enter a valid amount to review nutrition."}
                        </Text>
                      </View>
                      {adjustMode ? (
                        <View style={localStyles.weightEditRow}>
                          <TextInput
                            accessibilityLabel={`Amount of ${ing.name}`}
                            editable={!submitting}
                            maxLength={16}
                            style={localStyles.weightEditInput}
                            keyboardType="numeric"
                            value={ingredientAmounts[index] ?? ing.weight.toString()}
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
              {reviewError && <Text accessibilityRole="alert" style={localStyles.inlineError}>{reviewError}</Text>}
              {adjustMode ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Log reviewed recipe"
                  accessibilityState={{ disabled: submitting, busy: submitting }}
                  style={localStyles.confirmBtn}
                  onPress={confirmLog}
                  disabled={submitting}
                >
                  <Text style={localStyles.confirmText}>
                    {submitting ? "Logging..." : "Add adjusted recipe"}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={{ gap: 12 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Log reviewed recipe"
                    accessibilityState={{ disabled: submitting, busy: submitting }}
                    style={localStyles.confirmBtn}
                    onPress={confirmLog}
                    disabled={submitting}
                  >
                    <Text style={localStyles.confirmText}>
                      {submitting ? "Logging..." : "Add to today's food"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Adjust recipe amounts"
                    disabled={submitting}
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
        <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => { if (!deleting) { setDeleteModal(false); setDeletingRecipe(null); } }}>
          <View style={localStyles.deleteOverlay}>
            <TouchableOpacity
              accessible={false}
              disabled={deleting}
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
                  accessibilityRole="button"
                  disabled={deleting}
                  style={localStyles.btnKeep}
                  onPress={() => {
                    setDeleteModal(false);
                    setDeletingRecipe(null);
                  }}
                >
                  <Text style={localStyles.btnKeepText}>Keep it</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Remove saved recipe"
                  accessibilityState={{ disabled: deleting, busy: deleting }}
                  disabled={deleting}
                  style={localStyles.btnConfirmDelete}
                  onPress={confirmDelete}
                >
                  <Trash size={18} color={Colors.textOnAccent} weight="bold" />
                  <Text style={localStyles.btnConfirmDeleteText}>{deleting ? "Removing…" : "Remove"}</Text>
                </TouchableOpacity>
              </View>
              {deleteError && <Text accessibilityRole="alert" style={localStyles.inlineError}>{deleteError}</Text>}
            </View>
          </View>
        </Modal>

        <SweetFeedback
          visible={!!feedback}
          type={feedback?.type}
          title={feedback?.title ?? ""}
          message={feedback?.message}
          autoDismissMs={feedback?.autoDismissMs}
          onClose={() => setFeedback(null)}
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
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    padding: 9,
    backgroundColor: Colors.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  searchBox: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
    height: 56,
    borderWidth: 1,
    borderColor: Colors.borderLight,
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
    marginBottom: 16,
  },
  itemCard: {
    backgroundColor: Colors.secondary,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
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
    fontSize: 12,
    marginTop: 2,
  },
  editBtn: {
    paddingHorizontal: 12,
    minHeight: 44,
    flexDirection: "row",
    gap: 6,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 48,
  },
  deleteBtn: {
    paddingHorizontal: 12,
    minHeight: 44,
    flexDirection: "row",
    gap: 6,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 48,
  },
  recipeActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
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
    fontWeight: "600",
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
    borderRadius: 14,
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
    fontWeight: "600",
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
    fontSize: 12,
    marginTop: 2,
  },
  ingAmount: {
    color: Colors.accent,
    fontWeight: "600",
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
    fontWeight: "600",
    minWidth: 44,
    textAlign: "right",
    paddingVertical: 4,
  },
  weightEditUnit: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  bentoContainer: { flexDirection: "row", gap: 10, marginBottom: 22 },
  bentoMain: {
    flex: 1.2,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
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
    color: Colors.text,
    fontSize: 34,
    fontWeight: "600",
    letterSpacing: -1,
  },
  bentoLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "500",
    marginTop: 4,
  },
  bentoValueSmall: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  bentoLabelSmall: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  confirmBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
  },
  confirmText: {
    color: Colors.textOnAccent,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  adjustToggleBtn: {
    flexDirection: "row",
    backgroundColor: Colors.inputBg,
    paddingVertical: 16,
    borderRadius: 14,
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
    flexWrap: "wrap",
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
    fontWeight: "600",
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
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 8,
  },
  portionTimes: {
    color: Colors.textSecondary,
    fontSize: 18,
    fontWeight: "600",
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
    backgroundColor: Colors.surface,
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
    fontWeight: "600",
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
    fontWeight: "600",
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
  },
  btnConfirmDeleteText: {
    color: Colors.textOnAccent,
    fontSize: 16,
    fontWeight: "600",
  },
  inlineError: {
    color: Colors.error,
    fontSize: 13,
    lineHeight: 19,
    marginVertical: 12,
  },
});
