import {
  ChatCircleText,
  PaperPlaneTilt,
  X,
} from "phosphor-react-native";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AiEstimateBadge } from "@/src/components/ai/AiEstimateBadge";
import { BeeMascot } from "@/src/components/ai/BeeGuide";
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";
import { requestAiFood, type AiFood } from "@/src/lib/aiFood";
import { getAiFoodFeedback } from "@/src/lib/aiFoodUi";
import type { BeeSituation } from "@/src/lib/beeCompanion";
import {
  buildAiFoodLogInsert,
  getBeeQuickLogClarification,
  isBeeQuickLogConfirmation,
  mergeBeeQuickLogClarification,
  type BeeQuickLogClarification,
} from "@/src/lib/beeQuickLog";
import { upsertDailySummary } from "@/src/lib/dailySummary";
import { emitFoodLogChanged } from "@/src/lib/foodLogEvents";
import { supabase } from "@/src/lib/supabase";
import { Colors } from "@/src/styles/colors";
import { useResponsive } from "@/src/hooks/useResponsive";

type ChatMessage = {
  id: string;
  role: "bee" | "user";
  text: string;
  food?: AiFood;
  situation?: BeeSituation;
};

type FeedbackState = {
  type: SweetFeedbackType;
  title: string;
  message: string;
  confirmText?: string;
  autoDismissMs?: number;
};

const STARTER_MESSAGES: ChatMessage[] = [
  {
    id: "starter",
    role: "bee",
    situation: "greeting",
    text:
      'Tell Bee what you ate, like "600g chicken breast". If details matter, I\'ll ask before logging.',
  },
];

export function BeeQuickLog() {
  const { isDesktop } = useResponsive();
  const scrollRef = useRef<ScrollView | null>(null);
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(STARTER_MESSAGES);
  const [pendingClarification, setPendingClarification] =
    useState<BeeQuickLogClarification | null>(null);
  const [pendingFood, setPendingFood] = useState<AiFood | null>(null);
  const [pendingAlternatives, setPendingAlternatives] = useState<AiFood[]>([]);
  const [lastQuery, setLastQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const open = () => setVisible(true);
  const close = () => {
    if (!loading) setVisible(false);
  };

  const appendMessages = (
    nextMessages: ChatMessage[],
    options?: { replaceStarter?: boolean },
  ) => {
    setMessages((current) => {
      const shouldReplaceStarter =
        options?.replaceStarter &&
        current.length === 1 &&
        current[0]?.id === "starter";
      return [...(shouldReplaceStarter ? [] : current), ...nextMessages];
    });
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const submitText = async (text: string) => {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed || loading) return;

    setInput("");
    appendMessages(
      [{ id: createId("user"), role: "user", text: trimmed }],
      { replaceStarter: true },
    );

    if (pendingFood) {
      if (isBeeQuickLogConfirmation(trimmed)) {
        await logFood(pendingFood);
        return;
      }

      setPendingFood(null);
      setPendingAlternatives([]);
      appendMessages([
        {
          id: createId("bee"),
          role: "bee",
          situation: "searching",
          text: "Got it. I will check that instead before logging.",
        },
      ]);
      await resolveAndReview(trimmed);
      return;
    }

    if (pendingClarification) {
      const clarifiedQuery = mergeBeeQuickLogClarification(
        pendingClarification,
        trimmed,
      );
      setPendingClarification(null);
      await resolveAndReview(clarifiedQuery);
      return;
    }

    const clarification = getBeeQuickLogClarification(trimmed);
    if (clarification) {
      setPendingClarification(clarification);
      appendMessages([
        {
          id: createId("bee"),
          role: "bee",
          situation: "needsClarification",
          text: clarification.question,
        },
      ]);
      return;
    }

    await resolveAndReview(trimmed);
  };

  const resolveAndReview = async (query: string) => {
    setLoading(true);
    appendMessages([
      {
        id: createId("bee"),
        role: "bee",
        situation: "searching",
        text: "Checking the best match before logging...",
      },
    ]);

    const result = await requestAiFood(query, "auto");
    if (!result.ok) {
      const aiFeedback = getAiFoodFeedback(result.reason);
      setLoading(false);
      appendMessages([
        {
          id: createId("bee"),
          role: "bee",
          situation: "lookupError",
          text: aiFeedback.message,
        },
      ]);
      setFeedback(aiFeedback);
      return;
    }

    setLoading(false);
    setPendingFood(result.food);
    setPendingAlternatives(result.alternatives);
    setLastQuery(query);
    appendMessages([
      {
        id: createId("bee"),
        role: "bee",
        situation: "reviewingMatch",
        food: result.food,
        text: `I found ${result.food.serving_label} of ${result.food.name}: ${Math.round(
          result.food.kcal,
        )} kcal, P${Math.round(result.food.protein)} C${Math.round(
          result.food.carbs,
        )} F${Math.round(result.food.fat)}. Does this look right?`,
      },
    ]);
  };

  const findMoreOnWeb = async () => {
    if (!lastQuery || loading) return;
    setLoading(true);
    setPendingFood(null);
    setPendingAlternatives([]);
    appendMessages([
      {
        id: createId("bee"),
        role: "bee",
        situation: "searching",
        text: "Searching the web for a better match (this uses 1 AI credit)...",
      },
    ]);

    const result = await requestAiFood(lastQuery, "web");
    setLoading(false);
    if (!result.ok) {
      const aiFeedback = getAiFoodFeedback(result.reason);
      appendMessages([
        {
          id: createId("bee"),
          role: "bee",
          situation: "lookupError",
          text: aiFeedback.message,
        },
      ]);
      setFeedback(aiFeedback);
      return;
    }

    setPendingFood(result.food);
    setPendingAlternatives(result.alternatives);
    appendMessages([
      {
        id: createId("bee"),
        role: "bee",
        situation: "reviewingMatch",
        food: result.food,
        text: `From the web: ${result.food.serving_label} of ${result.food.name} — ${Math.round(
          result.food.kcal,
        )} kcal, P${Math.round(result.food.protein)} C${Math.round(
          result.food.carbs,
        )} F${Math.round(result.food.fat)}. Better?`,
      },
    ]);
  };

  const logFood = async (food: AiFood) => {
    if (loading) return;
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      setFeedback({
        type: "warning",
        title: "Sign in required",
        message: "Please sign in again before Bee logs this food.",
      });
      return;
    }

    const logRow = buildAiFoodLogInsert(user.id, food);
    const { error } = await supabase.from("food_logs").insert([logRow]);
    setLoading(false);

    if (error) {
      appendMessages([
        {
          id: createId("bee"),
          role: "bee",
          situation: "lookupError",
          text: "I found the food, but logging failed. Please try again.",
        },
      ]);
      setFeedback({
        type: "error",
        title: "Bee couldn't log it",
        message: "Please try again in a moment.",
      });
      return;
    }

    setPendingFood(null);
    setPendingAlternatives([]);
    await upsertDailySummary();
    emitFoodLogChanged();
    appendMessages([
      {
        id: createId("bee"),
        role: "bee",
        situation: "logSuccess",
        food,
        text: `Logged ${food.serving_label} of ${food.name}.`,
      },
    ]);
    setFeedback({
      type: "success",
      title: "Bee logged it",
      message: `${food.name} was added to today's log.`,
      autoDismissMs: 1200,
    });
  };

  const options = pendingClarification?.options ?? [];
  const inputPlaceholder = pendingFood
    ? "Type a correction, or tap Log it"
    : "I ate 600g chicken breast";
  const headerSituation: BeeSituation = loading
    ? "searching"
    : pendingClarification
      ? "needsClarification"
      : pendingFood
        ? "reviewingMatch"
        : "greeting";

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Open Bee quick log"
        activeOpacity={0.86}
        onPress={open}
        style={[
          styles.floatingButton,
          isDesktop ? styles.floatingButtonDesktop : styles.floatingButtonMobile,
        ]}
      >
        <View style={styles.launcherMascotViewport}>
          <BeeMascot size="small" situation="greeting" />
        </View>
        <View style={styles.floatingBadge}>
          <ChatCircleText size={13} color={Colors.textOnAccent} weight="fill" />
        </View>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.keyboardAvoid}
          >
            <Pressable
              accessibilityViewIsModal
              style={[styles.sheet, isDesktop && styles.sheetDesktop]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.header}>
                <View style={styles.headerAvatar}>
                  <BeeMascot size="small" situation={headerSituation} />
                </View>
                <View style={styles.headerCopy}>
                  <Text style={styles.title}>Bee quick log</Text>
                  <Text style={styles.subtitle}>
                    Describe it. I will ask if I need one detail.
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close Bee quick log"
                  onPress={close}
                  disabled={loading}
                  style={styles.closeButton}
                >
                  <X size={18} color={Colors.textSecondary} weight="bold" />
                </TouchableOpacity>
              </View>

              <ScrollView
                ref={scrollRef}
                style={styles.messages}
                contentContainerStyle={styles.messagesContent}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() =>
                  scrollRef.current?.scrollToEnd({ animated: true })
                }
              >
                {messages.map((message) => (
                  <View
                    key={message.id}
                    style={[
                      styles.messageRow,
                      message.role === "user"
                        ? styles.userMessageRow
                        : styles.beeMessageRow,
                    ]}
                  >
                    {message.role === "bee" ? (
                      <BeeMascot
                        size="small"
                        situation={message.situation ?? "greeting"}
                        style={styles.messageMascot}
                      />
                    ) : null}
                    <View
                      style={[
                        styles.messageBubble,
                        message.role === "user"
                          ? styles.userBubble
                          : styles.beeBubble,
                      ]}
                    >
                      <Text
                        style={[
                          styles.messageText,
                          message.role === "user"
                            ? styles.userMessageText
                            : styles.beeMessageText,
                        ]}
                      >
                        {message.text}
                      </Text>
                      {message.food ? (
                        <View style={styles.badgeRow}>
                          <AiEstimateBadge source={message.food.source} compact />
                          <Text style={styles.confidenceText}>
                            {message.food.confidence} confidence
                          </Text>
                          {message.food.source_detail ? (
                            <Text style={styles.sourceDetailText} numberOfLines={1}>
                              {message.food.source === "web" ? "from " : "matched: "}
                              {message.food.source_detail}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </ScrollView>

              {options.length > 0 ? (
                <View style={styles.optionWrap}>
                  {options.map((option) => (
                    <TouchableOpacity
                      accessibilityRole="button"
                      key={option}
                      activeOpacity={0.82}
                      disabled={loading}
                      onPress={() => submitText(option)}
                      style={styles.optionChip}
                    >
                      <Text style={styles.optionText}>{option}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {pendingFood ? (
                <View style={styles.optionWrap}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.82}
                    disabled={loading}
                    onPress={() => pendingFood && logFood(pendingFood)}
                    style={[styles.optionChip, styles.optionChipPrimary]}
                  >
                    <Text style={[styles.optionText, styles.optionTextPrimary]}>
                      Log it
                    </Text>
                  </TouchableOpacity>
                  {pendingAlternatives.map((alt) => (
                    <TouchableOpacity
                      accessibilityRole="button"
                      key={`${alt.source}-${alt.name}`}
                      activeOpacity={0.82}
                      disabled={loading}
                      onPress={() => {
                        setPendingFood(alt);
                        appendMessages([
                          {
                            id: createId("bee"),
                            role: "bee",
                            situation: "reviewingMatch",
                            food: alt,
                            text: `Swapped to ${alt.name}: ${Math.round(alt.kcal)} kcal, P${Math.round(
                              alt.protein,
                            )} C${Math.round(alt.carbs)} F${Math.round(alt.fat)}. Log it?`,
                          },
                        ]);
                      }}
                      style={styles.optionChip}
                    >
                      <Text style={styles.optionText} numberOfLines={1}>
                        {alt.name} · {Math.round(alt.kcal)} kcal
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {lastQuery ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      activeOpacity={0.82}
                      disabled={loading}
                      onPress={findMoreOnWeb}
                      style={styles.optionChip}
                    >
                      <Text style={styles.optionText}>🔎 Find more</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.82}
                    disabled={loading}
                    onPress={() => {
                      setPendingFood(null);
                      setPendingAlternatives([]);
                      appendMessages([
                        {
                          id: createId("bee"),
                          role: "bee",
                          situation: "needsClarification",
                          text: "No problem. Type the correction and I will search again.",
                        },
                      ]);
                    }}
                    style={styles.optionChip}
                  >
                    <Text style={styles.optionText}>Not right</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.inputRow}>
                <TextInput
                  accessibilityHint="Describe one food or meal, including the amount when you know it"
                  accessibilityLabel="Food description for Bee"
                  maxLength={200}
                  value={input}
                  onChangeText={setInput}
                  editable={!loading}
                  placeholder={inputPlaceholder}
                  placeholderTextColor={Colors.textMuted}
                  returnKeyType="send"
                  onSubmitEditing={() => submitText(input)}
                  style={styles.input}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Send to Bee"
                  activeOpacity={0.86}
                  disabled={loading || input.trim().length === 0}
                  onPress={() => submitText(input)}
                  style={[
                    styles.sendButton,
                    (loading || input.trim().length === 0) &&
                      styles.sendButtonDisabled,
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color={Colors.textOnAccent} size="small" />
                  ) : (
                    <PaperPlaneTilt
                      size={18}
                      color={Colors.textOnAccent}
                      weight="fill"
                    />
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {feedback && (
        <SweetFeedback
          visible
          type={feedback.type}
          title={feedback.title}
          message={feedback.message}
          confirmText={feedback.confirmText}
          autoDismissMs={feedback.autoDismissMs}
          onClose={() => setFeedback(null)}
        />
      )}
    </>
  );
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const styles = StyleSheet.create({
  floatingButton: {
    position: "absolute",
    zIndex: 50,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 4,
    overflow: "visible",
  },
  launcherMascotViewport: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  floatingButtonMobile: {
    right: 16,
    bottom: 112,
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  floatingButtonDesktop: {
    right: 24,
    bottom: 24,
  },
  floatingBadge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.58)",
    justifyContent: "flex-end",
  },
  keyboardAvoid: {
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    minHeight: 400,
    maxHeight: "86%",
    backgroundColor: Colors.secondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  sheetDesktop: {
    width: 460,
    maxHeight: 640,
    borderRadius: 24,
    alignSelf: "flex-end",
    marginRight: 24,
    marginBottom: 92,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerAvatar: {
    width: 46,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  messages: {
    maxHeight: 360,
  },
  messagesContent: {
    gap: 10,
    paddingTop: 14,
    paddingBottom: 22,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  beeMessageRow: {
    alignSelf: "stretch",
    gap: 6,
  },
  userMessageRow: {
    alignSelf: "flex-end",
    justifyContent: "flex-end",
    maxWidth: "88%",
  },
  messageMascot: {
    marginTop: 1,
  },
  messageBubble: {
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  beeBubble: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  userBubble: {
    backgroundColor: Colors.accent,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  beeMessageText: {
    color: Colors.text,
  },
  userMessageText: {
    color: Colors.textOnAccent,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 9,
  },
  confidenceText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  sourceDetailText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
    flexShrink: 1,
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 8,
    paddingBottom: 12,
  },
  optionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.accentDim,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  optionChipPrimary: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  optionText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  optionTextPrimary: {
    color: Colors.textOnAccent,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
    color: Colors.text,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: "500",
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  sendButtonDisabled: {
    opacity: 0.55,
  },
});
