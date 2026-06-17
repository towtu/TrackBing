import { useFocusEffect, useRouter } from "expo-router";
import {
  Cookie,
  CaretLeft,
  ForkKnife,
  MagnifyingGlass,
  Minus,
  Plus,
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
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";
import { supabase } from "@/src/lib/supabase";
import { upsertDailySummary } from "@/src/lib/dailySummary";
import {
  calcMacros,
  defaultWeightForUnit,
  getUnitsToDisplay,
  type FoodItem,
  type Unit,
} from "@/src/lib/macros";
import { Colors } from "@/src/styles/colors";
import { useResponsive } from "@/src/hooks/useResponsive";

type FeedbackState = {
  type: SweetFeedbackType;
  title: string;
  message: string;
  autoDismissMs?: number;
};

export default function MyFoodsPage() {
  const router = useRouter();
  const { isDesktop } = useResponsive();

  const [personalFoods, setPersonalFoods] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── SELECTED FOOD MODAL STATE ──
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [inputWeight, setInputWeight] = useState("100");
  const [selectedUnit, setSelectedUnit] = useState<Unit>("g");

  // ── DELETE MODAL STATE ──
  const [deleteModal, setDeleteModal] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [deletingFood, setDeletingFood] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);

  const fetchMyFoods = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("personal_foods")
      .select("*")
      .order("created_at", { ascending: false });
    const formatted: FoodItem[] =
      data?.map((f) => ({
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
    setPersonalFoods(formatted);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      fetchMyFoods();
    }, [])
  );

  const filteredFoods =
    filterQuery.length >= 2
      ? personalFoods.filter((f) =>
          f.product_name?.toLowerCase().includes(filterQuery.toLowerCase())
        )
      : personalFoods;

  // ── DELETE ──
  const handleDeletePress = (item: FoodItem) => {
    setDeletingFood({
      id: item.original_id!,
      name: item.product_name,
      code: item.code,
    });
    setDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!deletingFood) return;
    const { error } = await supabase
      .from("personal_foods")
      .delete()
      .eq("id", deletingFood.id);
    if (error) {
      setFeedback({
        type: "error",
        title: "Could not remove food",
        message: error.message,
      });
    } else {
      setPersonalFoods((prev) =>
        prev.filter((f) => f.code !== deletingFood.code)
      );
    }
    setDeleteModal(false);
    setDeletingFood(null);
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
        setSelectedFood(null);
        setFeedback({
          type: "success",
          title: "Logged!",
          message: "Added to today's food log.",
          autoDismissMs: 1100,
        });
      }
    }
    setSubmitting(false);
  };

  const unitsToDisplay = getUnitsToDisplay(selectedFood ?? undefined);

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
          <TouchableOpacity
            onPress={() => router.back()}
            style={localStyles.backButton}
          >
            <CaretLeft size={24} color={Colors.accent} weight="bold" />
          </TouchableOpacity>
          <Text style={localStyles.headerTitle}>My Foods</Text>
          <TouchableOpacity
            onPress={() => router.push("/create-food")}
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
            placeholder="Filter your foods..."
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

        {/* ── FOOD COUNT BADGE ── */}
        <View style={localStyles.countRow}>
          <View style={localStyles.countBadge}>
            <Cookie size={14} color={Colors.accent} weight="fill" />
            <Text style={localStyles.countText}>
              {filteredFoods.length}{" "}
              {filteredFoods.length === 1 ? "food" : "foods"}
            </Text>
          </View>
        </View>

        {/* ── FOOD LIST ── */}
        {loading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            key={isDesktop ? "desktop" : "mobile"}
            numColumns={isDesktop ? 2 : 1}
            columnWrapperStyle={isDesktop ? { gap: 16 } : undefined}
            data={filteredFoods}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <View
                style={[
                  localStyles.itemRowContainer,
                  isDesktop && { flex: 1, marginBottom: 16, marginRight: 0 },
                ]}
              >
                <TouchableOpacity
                  style={localStyles.itemCard}
                  onPress={() => {
                    Keyboard.dismiss();
                    setSelectedFood(item);
                    const u = (item.default_unit as Unit) || "g";
                    setSelectedUnit(u);
                    setInputWeight(defaultWeightForUnit(u));
                  }}
                >
                  <View style={localStyles.iconCircle}>
                    <Text style={{ fontSize: 18 }}>🍪</Text>
                  </View>
                  <View style={{ flex: 1, flexShrink: 1, marginLeft: 12 }}>
                    <Text style={localStyles.itemName} numberOfLines={2}>
                      {item.product_name}
                    </Text>
                    <Text style={localStyles.itemSub}>
                      {Math.round(item.nutriments?.["energy-kcal_100g"] || 0)}{" "}
                      kcal · P:{Math.round(item.nutriments?.proteins_100g || 0)}g
                      · C:
                      {Math.round(item.nutriments?.carbohydrates_100g || 0)}g ·
                      F:{Math.round(item.nutriments?.fat_100g || 0)}g
                    </Text>
                  </View>
                  <View style={localStyles.unitBadge}>
                    <Text style={localStyles.unitBadgeText}>
                      {item.default_unit}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={localStyles.deleteBtn}
                  onPress={() => handleDeletePress(item)}
                >
                  <Trash size={20} color="#FF4444" weight="bold" />
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <View style={localStyles.emptyState}>
                <View style={localStyles.emptyIconBox}>
                  <ForkKnife
                    size={36}
                    color={Colors.textSecondary}
                    weight="duotone"
                  />
                </View>
                <Text style={localStyles.emptyTitle}>
                  {filterQuery.length >= 2
                    ? `No foods matching "${filterQuery}"`
                    : "No custom foods yet"}
                </Text>
                <Text style={localStyles.emptySubtext}>
                  {filterQuery.length >= 2
                    ? "Try a different search term"
                    : "Add a food when you can't find it in search."}
                </Text>
                {filterQuery.length < 2 && (
                  <TouchableOpacity
                    style={localStyles.emptyCreateBtn}
                    onPress={() => router.push("/create-food")}
                  >
                    <Plus size={20} color={Colors.accent} />
                    <Text
                      style={{
                        color: Colors.text,
                        fontWeight: "bold",
                        fontSize: 14,
                      }}
                    >
                      Create Food
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            }
          />
        )}

        {/* ── LOG FOOD MODAL ── */}
        <Modal visible={!!selectedFood} transparent animationType="fade">
          <View style={localStyles.modalOverlay}>
            <View style={localStyles.modalContent}>
              <View style={localStyles.modalDragBar} />
              <View style={localStyles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.modalFoodName}>
                    {selectedFood?.product_name}
                  </Text>
                  <Text style={{ color: Colors.textSecondary }}>My Food</Text>
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
                    style={[{ marginTop: 8 }, localStyles.unitBarStyle]}
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
                    <Text style={localStyles.bentoValueSmall}>{macros.cb}g</Text>
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
                  {submitting ? "Adding..." : "Log this food"}
                </Text>
              </TouchableOpacity>
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
                setDeletingFood(null);
              }}
            />
            <View style={localStyles.glassModal}>
              <View style={localStyles.glassModalDrag} />
              <View style={localStyles.deleteModalIcon}>
                <Trash size={32} color={Colors.error} weight="fill" />
              </View>
              <Text style={localStyles.deleteModalTitle}>Remove Food</Text>
              <Text style={localStyles.deleteModalSubtitle}>
                Are you sure you want to delete &quot;{deletingFood?.name}&quot;
                from your foods?
              </Text>
              <View style={localStyles.deleteModalBtnRow}>
                <TouchableOpacity
                  style={localStyles.btnKeep}
                  onPress={() => {
                    setDeleteModal(false);
                    setDeletingFood(null);
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
  unitBadge: {
    backgroundColor: Colors.accentDim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.2)",
  },
  unitBadgeText: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  unitBarStyle: {
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
