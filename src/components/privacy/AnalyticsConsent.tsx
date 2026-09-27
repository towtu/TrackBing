import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { LegalLinks } from "@/src/components/legal/LegalLinks";
import { analyticsStore, initialiseAnalytics } from "@/src/lib/analyticsRuntime";
import { Colors } from "@/src/styles/colors";

function useAnalyticsConsent() {
  const snapshot = useSyncExternalStore(analyticsStore.subscribe, analyticsStore.getSnapshot, analyticsStore.getServerSnapshot);
  useEffect(() => { initialiseAnalytics(); }, []);
  return snapshot;
}

function ConsentButton({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, primary && styles.primaryButton, focused && styles.focusedButton, pressed && { opacity: 0.8 }]}
  ><Text style={[styles.buttonText, primary && { color: Colors.textOnAccent }]}>{label}</Text></Pressable>;
}

export function AnalyticsConsentBanner({ pathname }: { pathname: string }) {
  const state = useAnalyticsConsent();
  useEffect(() => {
    if (state.consent === "accepted") void analyticsStore.trackPage(pathname);
  }, [pathname, state.consent]);
  if (!state.configured || state.privacySignal || !state.storageAvailable || state.consent !== "pending") return null;
  return <View style={styles.banner}>
    <View style={styles.inner}>
      <Text accessibilityRole="header" style={styles.title}>Optional web analytics</Text>
      <Text style={styles.copy}>Allow Plausible to count page visits and completed sign-ins? Food entries, Bee chats, email addresses and body measurements are excluded. Your choice won&apos;t affect sign-in.</Text>
      <View style={styles.actions}>
        <ConsentButton label="Decline analytics" onPress={() => analyticsStore.choose("declined")} />
        <ConsentButton label="Accept analytics" onPress={() => analyticsStore.choose("accepted")} primary />
      </View>
      <Text style={styles.note}>You can change this browser&apos;s choice in Profile → Privacy.</Text>
      <LegalLinks />
    </View>
  </View>;
}

export function AnalyticsPrivacyControls() {
  const state = useAnalyticsConsent();
  const canChoose = state.configured && !state.privacySignal && state.storageAvailable;
  let status = "Optional web analytics is off. It is not configured for this site.";
  if (Platform.OS !== "web") status = "Optional analytics is off in the app. The analytics choice applies only to the web version.";
  else if (state.privacySignal) status = "Optional web analytics is off because your browser has requested no tracking.";
  else if (state.configured && !state.storageAvailable) status = "Optional web analytics is off because this browser cannot save your privacy preference.";
  else if (canChoose) status = state.consent === "accepted" ? "Optional web analytics is on for this browser." : "Optional web analytics is off for this browser.";
  return <View style={styles.controls}>
    <Text accessibilityRole="header" style={styles.title}>Privacy</Text>
    <Text style={styles.copy}>Essential sign-in storage keeps you signed in. It is separate from optional analytics.</Text>
    <Text accessibilityLiveRegion="polite" style={styles.copy}>{status}</Text>
    {canChoose && <>
      <Text style={styles.copy}>Plausible counts approved page visits and completed sign-ins. We send no food entries, chats, email addresses or body measurements. Your choice is saved in this browser.</Text>
      <View style={styles.actions}>
        {state.consent !== "accepted" && <ConsentButton label="Allow optional analytics" onPress={() => analyticsStore.choose("accepted")} primary />}
        {state.consent !== "declined" && <ConsentButton label="Turn off optional analytics" onPress={() => analyticsStore.choose("declined")} />}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  banner: { backgroundColor: Colors.surface, borderTopWidth: 1, borderColor: Colors.border, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, width: "100%" },
  inner: { width: "100%", maxWidth: 1080, alignSelf: "center", gap: 10 },
  controls: { gap: 12, width: "100%" },
  title: { color: Colors.text, fontSize: 17, fontWeight: "800" },
  copy: { color: Colors.textSecondary, fontSize: 14, lineHeight: 21 },
  note: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: { borderWidth: 2, borderColor: Colors.controlBorder, borderRadius: 12, minHeight: 44, paddingVertical: 10, paddingHorizontal: 16, justifyContent: "center", alignItems: "center" },
  primaryButton: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  focusedButton: { borderColor: Colors.text },
  buttonText: { color: Colors.text, fontSize: 14, fontWeight: "700" },
});
