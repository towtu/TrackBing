import { ChatCircleText, PaperPlaneTilt, X } from "phosphor-react-native";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BeeMascot } from "@/src/components/ai/BeeGuide";
import { BeeAction, BeeMemories } from "@/src/components/ai/BeeMemories";
import { BeeGroundedAnswer } from "@/src/components/ai/BeeGroundedAnswer";
import { useResponsive } from "@/src/hooks/useResponsive";
import {
  createBeeClient,
  createBeeRequest,
  createBeeRetryRequest,
  getBeeErrorFeedback,
  getBeeSourceUrl,
  isCurrentBeeReview,
  type BeeCommand,
  type BeeErrorCode,
  type BeeRequest,
  type BeeSnapshot,
  type PendingFood,
} from "@/src/lib/beeChat";
import type { BeeSituation } from "@/src/lib/beeCompanion";
import { emitFoodLogChanged } from "@/src/lib/foodLogEvents";
import { Colors, Radii } from "@/src/styles/colors";

type FailedRequest = { request: BeeRequest; error: BeeErrorCode };
const LIVE_ANSWER_PLACEHOLDER = "I showed a live search answer. Search again to refresh it, or use a barcode or package label to add food.";

export function BeeQuickLog({ userId }: { userId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDesktop, height } = useResponsive();
  const scrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const clientRef = useRef<ReturnType<typeof createBeeClient> | null>(null);
  const snapshotRef = useRef<BeeSnapshot | null>(null);
  const busyRef = useRef(false);
  const focusAfterOpenRef = useRef(false);
  const lastSavedLog = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<"chat" | "memories">("chat");
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [snapshot, setSnapshot] = useState<BeeSnapshot | null>(null);
  const [activeRequest, setActiveRequest] = useState<BeeRequest | null>(null);
  const [failed, setFailed] = useState<FailedRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [startingNew, setStartingNew] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [editingPortion, setEditingPortion] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const client = createBeeClient(userId);
    clientRef.current = client;
    snapshotRef.current = null;
    busyRef.current = false;
    lastSavedLog.current = null;
    setSnapshot(null);
    setInput("");
    setActiveRequest(null);
    setFailed(null);
    setNotice(null);
    setVisible(false);
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (!visible || !snapshot?.pending) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [visible, snapshot?.pending]);

  const execute = async (request: BeeRequest): Promise<boolean> => {
    const client = clientRef.current;
    if (!client || busyRef.current) return false;
    busyRef.current = true;
    setActiveRequest(request);
    setFailed(null);
    setNotice(null);
    const result = await client.send(request);
    if (clientRef.current !== client) return false;
    busyRef.current = false;
    setActiveRequest(null);
    if (!result) return false;
    if (!result.ok) {
      setFailed({ request, error: result.error });
      return false;
    }

    snapshotRef.current = result.snapshot;
    setSnapshot(result.snapshot);
    setNow(Date.now());
    setEditingPortion(false);
    if (result.snapshot.saved_log_id && result.snapshot.saved_log_id !== lastSavedLog.current) {
      lastSavedLog.current = result.snapshot.saved_log_id;
      // The server owns both the food write and summary recomputation.
      emitFoodLogChanged();
      setNotice(result.snapshot.summary_warning
        ? "Food saved. Your daily summary still needs to refresh."
        : "Added to today's food log.");
    }
    if (request.command.kind === "message") {
      const sent = request.command.text;
      setInput((current) => current.trim() === sent ? "" : current);
    }
    if (request.command.kind === "new_thread") {
      setInput("");
      setView("chat");
      setStartingNew(false);
      setNotice("New conversation started. Your saved preferences are still available.");
    }
    if (request.command.kind === "clear_chat") {
      setInput("");
      setView("chat");
      setClearingChat(false);
      setNotice("This conversation was cleared. Your saved preferences and food diary are still available.");
    }
    return true;
  };

  const sendCommand = (command: BeeCommand) => execute(createBeeRequest(command, snapshotRef.current));
  const retryFailed = async (failure: FailedRequest) => {
    if (failure.error === "provider_unavailable" || failure.error === "save_failed") {
      if (!await execute(createBeeRequest({ kind: "load" }, snapshotRef.current))) return;
      const retry = createBeeRetryRequest(failure.request, failure.error, snapshotRef.current);
      if (retry) await execute(retry);
      else setNotice("Conversation refreshed. Check the latest food review or saved entry before continuing.");
      return;
    }
    await execute(failure.request);
  };
  const open = () => {
    focusAfterOpenRef.current = true;
    setVisible(true);
    setNow(Date.now());
    if (!busyRef.current && !failed) void sendCommand({ kind: "load" });
  };
  const close = () => setVisible(false);
  const enterManually = () => {
    close();
    router.push("/create-food");
  };
  const scanBarcode = () => {
    close();
    router.push("/scan");
  };
  const submitText = () => {
    const text = input.trim();
    if (!text || !snapshot || failed || busyRef.current) return;
    void sendCommand({ kind: "message", text });
  };
  const confirmDraft = (draft: PendingFood) => {
    if (!failed && isCurrentBeeReview(draft, snapshotRef.current)) {
      void sendCommand({ kind: "confirm", actionId: draft.id, reviewVersion: draft.review_version });
    }
  };
  const editPortion = () => {
    setEditingPortion(true);
    inputRef.current?.focus();
  };

  const loading = activeRequest !== null;
  const feedback = failed ? getBeeErrorFeedback(failed.error) : null;
  const messages = snapshot?.messages.slice(-50) ?? [];
  const lastMessage = messages[messages.length - 1];
  const displayedMessages = snapshot?.liveAnswer && lastMessage?.role === "assistant" && lastMessage.text === LIVE_ANSWER_PLACEHOLDER
    ? messages.slice(0, -1)
    : messages;
  const pending = snapshot?.pending;
  const pendingInMessages = pending && messages.some((message) =>
    message.draft?.id === pending.id && message.draft.review_version === pending.review_version);
  const headerSituation: BeeSituation = loading ? "searching" : failed ? "lookupError" : pending ? "reviewingMatch" : "greeting";
  const blocked = loading || failed !== null || snapshot === null;
  useEffect(() => {
    if (Platform.OS === "web" && visible && view === "chat" && !blocked && focusAfterOpenRef.current) {
      focusAfterOpenRef.current = false;
      inputRef.current?.focus();
    }
  }, [visible, view, blocked]);

  const renderReview = (draft: PendingFood) => (
    <FoodReview
      draft={draft}
      current={isCurrentBeeReview(draft, snapshot, now)}
      busy={blocked}
      onConfirm={() => confirmDraft(draft)}
      onEdit={editPortion}
      onCancel={() => void sendCommand({ kind: "cancel", actionId: draft.id, reviewVersion: draft.review_version })}
    />
  );

  return (
    <>
      <BeeAction
        label="Open Bee quick log"
        iconOnly
        onPress={open}
        style={[styles.floatingButton, isDesktop ? styles.floatingButtonDesktop : styles.floatingButtonMobile]}
        icon={(
          <>
            <View style={styles.launcherMascotViewport}><BeeMascot size="small" situation="greeting" /></View>
            <View style={styles.floatingBadge}><ChatCircleText size={13} color={Colors.textOnAccent} weight="fill" /></View>
          </>
        )}
      />

      <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessible={false} tabIndex={-1}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboardAvoid}>
            <Pressable
              accessibilityViewIsModal
              accessibilityLabel="Bee conversation"
              role="dialog"
              aria-modal
              accessible={false}
              tabIndex={-1}
              style={[
                styles.sheet,
                { height: Math.max(260, Math.min(height * 0.9, 760)), paddingBottom: Math.max(16, insets.bottom) },
                isDesktop && styles.sheetDesktop,
              ]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.header}>
                <View style={styles.headerAvatar}><BeeMascot size="small" situation={headerSituation} /></View>
                <View style={styles.headerCopy}>
                  <Text accessibilityRole="header" style={styles.title}>Bee</Text>
                  <Text style={styles.subtitle}>Your food and nutrition companion</Text>
                </View>
                <BeeAction label="Close Bee quick log" iconOnly onPress={close} icon={<X size={18} color={Colors.textSecondary} weight="bold" />} />
              </View>

              <View style={styles.toolbar}>
                <BeeAction label={view === "chat" ? "Saved preferences" : "Back to conversation"} disabled={!snapshot} onPress={() => setView(view === "chat" ? "memories" : "chat")} />
                {view === "chat" ? (
                  <>
                    <BeeAction label="New conversation" disabled={blocked} onPress={() => { setClearingChat(false); setStartingNew((current) => !current); }} />
                    <BeeAction label="Clear chat" disabled={blocked || messages.length === 0} onPress={() => { setStartingNew(false); setClearingChat((current) => !current); }} />
                  </>
                ) : null}
              </View>

              {startingNew ? (
                <View style={styles.newConversation}>
                  <Text style={styles.messageText}>Start fresh here? Bee keeps your saved preferences and earlier conversations. Unconfirmed food stays unlogged.</Text>
                  <View style={styles.actions}>
                    <BeeAction label="Start new" primary disabled={blocked} onPress={() => void sendCommand({ kind: "new_thread" })} />
                    <BeeAction label="Keep chatting" disabled={loading} onPress={() => setStartingNew(false)} />
                  </View>
                </View>
              ) : null}

              {clearingChat ? (
                <View style={styles.newConversation}>
                  <Text style={styles.messageText}>Delete this conversation? Your saved preferences, earlier conversations, and food diary stay available.</Text>
                  <View style={styles.actions}>
                    <BeeAction label="Delete this chat" primary disabled={blocked} onPress={() => void sendCommand({ kind: "clear_chat" })} />
                    <BeeAction label="Keep chatting" disabled={loading} onPress={() => setClearingChat(false)} />
                  </View>
                </View>
              ) : null}

              <ScrollView
                ref={scrollRef}
                style={styles.messages}
                contentContainerStyle={styles.messagesContent}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => {
                  if (view === "chat") scrollRef.current?.scrollToEnd({ animated: false });
                }}
              >
                {view === "memories" && snapshot ? (
                  <BeeMemories
                    memories={snapshot.memories}
                    busy={blocked}
                    onCommand={sendCommand}
                    onProfile={() => { close(); router.push("/(tabs)/profile"); }}
                  />
                ) : (
                  <>
                    {!snapshot && loading ? (
                      <View accessible={false} style={styles.loadingSkeleton}>
                        <View style={styles.skeletonLine} />
                        <View style={[styles.skeletonLine, styles.skeletonShort]} />
                      </View>
                    ) : null}
                    {snapshot && messages.length === 0 ? (
                      <View style={styles.welcome}>
                        <BeeMascot size="medium" situation="greeting" />
                        <Text style={styles.welcomeTitle}>What can I help with?</Text>
                        <Text style={styles.welcomeText}>
                          Ask about your nutrition targets or tell me what you ate. I’ll ask for details, then show a portion to review before saving food.
                        </Text>
                        <View style={styles.starters}>
                          <BeeAction label="What do you know about me?" disabled={blocked} onPress={() => void sendCommand({ kind: "message", text: "What do you know about me?" })} />
                          <BeeAction label="Help me log a food" disabled={blocked} onPress={() => { setInput("I ate "); inputRef.current?.focus(); }} />
                        </View>
                      </View>
                    ) : null}
                    {displayedMessages.map((message) => (
                      <View key={message.id} style={[styles.messageRow, message.role === "user" ? styles.userMessageRow : styles.beeMessageRow]}>
                        {message.role === "assistant" ? <BeeMascot size="small" situation={message.draft ? "reviewingMatch" : "greeting"} style={styles.messageMascot} /> : null}
                        <View style={[styles.messageBubble, message.role === "user" ? styles.userBubble : styles.beeBubble]}>
                          <Text selectable style={[styles.messageText, message.role === "user" && styles.userMessageText]}>{message.text}</Text>
                          {message.draft ? renderReview(message.draft) : null}
                        </View>
                      </View>
                    ))}
                    {snapshot?.liveAnswer ? (
                      <View style={[styles.messageRow, styles.beeMessageRow]}>
                        <BeeMascot size="small" situation="greeting" style={styles.messageMascot} />
                        <View style={[styles.messageBubble, styles.beeBubble]}>
                          <BeeGroundedAnswer key={`${snapshot.thread.id}:${snapshot.thread.version}`} answer={snapshot.liveAnswer} />
                        </View>
                      </View>
                    ) : null}
                    {pending && !pendingInMessages ? renderReview(pending) : null}
                  </>
                )}

                {loading ? (
                  <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={Colors.accent} />
                    <Text style={styles.subtitle}>
                      {activeRequest.command.kind === "load" ? "Opening your conversation…" : activeRequest.command.kind === "confirm" ? "Saving food…" : activeRequest.command.kind.startsWith("memory_") ? "Updating your preferences…" : "Bee is thinking…"}
                    </Text>
                  </View>
                ) : null}
                {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
                {view === "chat" ? (
                  <View style={styles.actions}>
                    <BeeAction label="Enter food manually" onPress={enterManually} style={styles.manualButton} />
                    <BeeAction label="Scan a barcode" onPress={scanBarcode} style={styles.manualButton} />
                  </View>
                ) : null}
                {view === "chat" && messages.length > 0 ? <Text style={styles.retention}>Chats are kept for up to 30 days. Showing the latest 50 messages.</Text> : null}
              </ScrollView>

              {failed && feedback ? (
                <View style={styles.feedback}>
                  <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.messageText}>{feedback.message}</Text>
                  <View style={styles.actions}>
                    {feedback.action === "retry" ? <BeeAction label="Retry" primary disabled={loading} onPress={() => void retryFailed(failed)} /> : null}
                    {feedback.action !== "none" ? (
                      <BeeAction label="Refresh conversation" disabled={loading} onPress={() => void execute(createBeeRequest({ kind: "load" }, failed.error === "not_found" ? null : snapshotRef.current))} />
                    ) : null}
                  </View>
                </View>
              ) : null}

              {view === "chat" ? (
                <View style={styles.composer}>
                  {editingPortion ? <Text style={styles.subtitle}>Enter the new amount and unit. Bee will show an updated review.</Text> : null}
                  <View style={styles.inputRow}>
                    <TextInput
                      ref={inputRef}
                      accessibilityLabel="Message to Bee"
                      accessibilityHint="Ask a question, describe a food, or correct the reviewed portion"
                      maxLength={1000}
                      multiline
                      submitBehavior="submit"
                      value={input}
                      onChangeText={setInput}
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => setInputFocused(false)}
                      editable={!loading}
                      placeholder={editingPortion ? "For example, make that 150 g" : pending ? "Change the portion or say yes" : "Ask Bee or describe a food"}
                      placeholderTextColor={Colors.textSecondary}
                      returnKeyType="send"
                      onSubmitEditing={submitText}
                      style={[styles.input, inputFocused && styles.inputFocused]}
                    />
                    <BeeAction
                      label="Send to Bee"
                      iconOnly
                      primary
                      disabled={blocked || input.trim().length === 0}
                      onPress={submitText}
                      style={styles.sendButton}
                      icon={<PaperPlaneTilt size={18} color={Colors.textOnAccent} weight="fill" />}
                    />
                  </View>
                </View>
              ) : null}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </>
  );
}

function FoodReview({ draft, current, busy, onConfirm, onEdit, onCancel }: {
  draft: PendingFood;
  current: boolean;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const [sourceError, setSourceError] = useState(false);
  const food = draft.food;
  const source = food.evidence;
  const sourceUrl = getBeeSourceUrl(source.url);
  const expired = draft.status === "expired" || Date.parse(draft.expires_at) <= Date.now();
  const status = draft.status === "confirmed" ? "Added to food log" : draft.status === "cancelled" ? "Cancelled" : expired ? "Review expired — send the portion again" : "Previous review — use the latest portion";

  const openSource = async () => {
    if (!sourceUrl) return;
    try {
      await Linking.openURL(sourceUrl);
      setSourceError(false);
    } catch {
      setSourceError(true);
    }
  };

  return (
    <View style={styles.review}>
      <Text style={styles.foodName}>{food.name}</Text>
      <Text style={styles.serving}>{food.servingLabel}{food.grams === null || /\d[\d.,]*\s*(?:g|grams?)\b/i.test(food.servingLabel) ? "" : ` · ${formatNumber(food.grams)} g`}</Text>
      <Text style={styles.calories}>{Math.round(food.calories)} kcal</Text>
      <View style={styles.macros}>
        <Text style={styles.macro}>Protein {formatNumber(food.protein)} g</Text>
        <Text style={styles.macro}>Carbs {formatNumber(food.carbs)} g</Text>
        <Text style={styles.macro}>Fat {formatNumber(food.fat)} g</Text>
      </View>
      <Text style={styles.sourceType}>{food.source === "user_label" ? "Your nutrition label" : food.source === "my_food" ? "Your saved food" : food.source === "openfoodfacts" ? "Open Food Facts product label" : food.source === "usda" ? "USDA nutrition" : "Nutrition source"}</Text>
      <Text style={styles.calculation}>
        {food.grams !== null && source.basis.grams !== null
          ? `${formatNumber(food.grams)} g ÷ ${formatNumber(source.basis.grams)} g × ${formatNumber(source.basis.nutrients.calories)} kcal = ${Math.round(food.calories)} kcal`
          : `Source serving: ${source.basis.count === null ? "" : `${formatNumber(source.basis.count)} `}${source.basis.unit} · ${formatNumber(source.basis.nutrients.calories)} kcal`}
      </Text>
      {source.attribution ? <Text style={styles.calculation}>{source.attribution}{source.license ? ` · ${source.license}` : ""}</Text> : null}
      {sourceUrl ? (
        <BeeAction label={source.title || "View nutrition source"} accessibilityLabel={"Open nutrition source: " + (source.title || sourceUrl)} role="link" onPress={() => void openSource()} style={styles.sourceButton} />
      ) : <Text style={styles.calculation}>{source.title}</Text>}
      {sourceError ? <Text accessibilityLiveRegion="polite" style={styles.calculation}>Couldn’t open the source. Try the link again.</Text> : null}
      <Text style={styles.reviewDate}>For {draft.local_date}</Text>
      {current ? (
        <View style={styles.reviewActions}>
          <BeeAction label="Add to today" primary disabled={busy} onPress={onConfirm} style={styles.addButton} />
          <View style={styles.actions}>
            <BeeAction label="Edit portion" disabled={busy} onPress={onEdit} />
            <BeeAction label="Cancel" accessibilityLabel={"Cancel " + food.name} disabled={busy} onPress={onCancel} />
          </View>
        </View>
      ) : (
        <View style={styles.reviewActions}>
          <Text style={styles.reviewStatus}>{status}</Text>
          <BeeAction label="Add to today" disabled onPress={onConfirm} />
        </View>
      )}
    </View>
  );
}

function formatNumber(value: number): string {
  return Number(value.toFixed(1)).toString();
}

const styles = StyleSheet.create({
  floatingButton: {
    position: "absolute", zIndex: 50, width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, elevation: 4, overflow: "visible", padding: 0,
  },
  launcherMascotViewport: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  floatingButtonMobile: { right: 16, bottom: 112, width: 52, height: 52, borderRadius: 26 },
  floatingButtonDesktop: { right: 24, bottom: 24 },
  floatingBadge: {
    position: "absolute", right: -1, bottom: -1, width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center", backgroundColor: Colors.accent, borderWidth: 2, borderColor: Colors.primary,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.58)", justifyContent: "flex-end" },
  keyboardAvoid: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    width: "100%", maxWidth: 620, alignSelf: "center", flexShrink: 1, backgroundColor: Colors.secondary,
    borderTopLeftRadius: Radii.card, borderTopRightRadius: Radii.card,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  sheetDesktop: { width: 480, maxHeight: 680, borderRadius: Radii.card, alignSelf: "flex-end", marginRight: 24, marginBottom: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerAvatar: { width: 46, height: 52, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: Colors.text, fontSize: 18, fontWeight: "700" },
  subtitle: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 2 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 10 },
  newConversation: { gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  messages: { flex: 1, minHeight: 0 },
  messagesContent: { gap: 14, paddingTop: 6, paddingBottom: 14 },
  messageRow: { flexDirection: "row", alignItems: "flex-start" },
  beeMessageRow: { alignSelf: "stretch", gap: 6 },
  userMessageRow: { alignSelf: "flex-end", justifyContent: "flex-end", maxWidth: "88%" },
  messageMascot: { width: 34, marginTop: 1 },
  messageBubble: { borderRadius: Radii.card, paddingHorizontal: 12, paddingVertical: 11 },
  beeBubble: { flex: 1, minWidth: 0, backgroundColor: Colors.surface },
  userBubble: { backgroundColor: Colors.accent },
  messageText: { color: Colors.text, fontSize: 14, lineHeight: 21 },
  userMessageText: { color: Colors.textOnAccent },
  welcome: { alignItems: "center", gap: 12, paddingVertical: 12 },
  welcomeTitle: { color: Colors.text, fontSize: 18, fontWeight: "700" },
  welcomeText: { color: Colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 360 },
  starters: { gap: 8, alignSelf: "stretch", marginTop: 4 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  loadingSkeleton: { gap: 12, paddingVertical: 12 },
  skeletonLine: { height: 54, borderRadius: Radii.inner, backgroundColor: Colors.surface },
  skeletonShort: { width: "70%", height: 38 },
  notice: { color: Colors.text, fontSize: 13, lineHeight: 19, paddingVertical: 8 },
  manualButton: { alignSelf: "flex-start" },
  retention: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  feedback: { gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  composer: { gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: {
    flex: 1, minWidth: 0, minHeight: 48, maxHeight: 112, borderRadius: Radii.inner,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBg,
    color: Colors.text, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, lineHeight: 20, textAlignVertical: "top",
  },
  inputFocused: { borderColor: Colors.accent, outlineColor: Colors.accent, outlineWidth: 2, outlineOffset: 1 },
  sendButton: { width: 48, height: 48 },
  review: { gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  foodName: { color: Colors.text, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  serving: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  calories: { color: Colors.accent, fontSize: 21, fontWeight: "700" },
  macros: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  macro: { color: Colors.text, fontSize: 12, lineHeight: 18 },
  sourceType: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  calculation: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  sourceButton: { alignSelf: "flex-start", maxWidth: "100%" },
  reviewDate: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  reviewActions: { gap: 8, marginTop: 3 },
  addButton: { alignSelf: "stretch" },
  reviewStatus: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
});
