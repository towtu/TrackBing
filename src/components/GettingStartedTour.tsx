import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clipSpotlight, type SpotlightFrame } from "@/src/lib/gettingStarted";
import { Colors } from "@/src/styles/colors";

const steps = [
  { target: "calories", title: "Your daily calories", text: "See what you’ve logged today and how it compares with your daily target. You can review your target in Profile." },
  { target: "log", title: "Log food", text: "Find a food, review the portion you ate, and add it to your diary." },
  { target: "scan", title: "Scan a barcode", text: "Find packaged foods by their barcode. If a label is missing, you can enter it and save it for next time." },
] as const;

export type TourTarget = (typeof steps)[number]["target"];
export type TourAnchor = Pick<View, "measureInWindow">;

type Props = {
  accountId: string;
  ready: boolean;
  getAnchor: (target: TourTarget) => TourAnchor | null;
  scrollBy: (distance: number) => void;
  onFinished: (accountId: string) => void;
  onLogFood: () => void;
};

export function GettingStartedTour({ accountId, ready, getAnchor, scrollBy, onFinished, onLogFood }: Props) {
  const storageKey = `trackbing:getting-started:v1:${accountId}`;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<{ step: number; frame: SpotlightFrame | null } | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey).then((seen) => {
      if (!active) return;
      if (seen) onFinished(accountId);
      else setStep(0);
    }).catch(() => {
      if (active) setStep(0);
    });
    return () => { active = false; };
  }, [accountId, onFinished, storageKey]);

  useEffect(() => {
    if (!ready || step === null) return;
    let active = true;
    let animation = 0;
    const target = getAnchor(steps[step].target);
    const measure = (allowScroll: boolean) => {
      target?.measureInWindow((x, y, targetWidth, targetHeight) => {
        if (!active) return;
        const comfortableTop = Math.max(72, Math.round(height * 0.13));
        if (allowScroll && targetHeight > 0 && Number.isFinite(y) &&
          (y < comfortableTop || y + targetHeight > height * 0.60)) {
          scrollBy(y - comfortableTop);
          animation = requestAnimationFrame(() => {
            animation = requestAnimationFrame(() => measure(false));
          });
          return;
        }
        setHighlight({ step, frame: clipSpotlight({ x, y, width: targetWidth, height: targetHeight }, width, height) });
      });
    };
    animation = requestAnimationFrame(() => measure(true));
    return () => { active = false; cancelAnimationFrame(animation); };
  }, [getAnchor, height, ready, scrollBy, step, width]);

  if (!ready || step === null) return null;

  const current = steps[step];
  const frame = highlight?.step === step ? highlight.frame : null;
  const lastStep = step === steps.length - 1;
  const leftSpace = frame?.x ?? 0;
  const rightSpace = frame ? width - frame.x - frame.width : 0;
  const sideSpace = Math.max(leftSpace, rightSpace);
  const sideCard = height < 540 && sideSpace >= 290 ? {
    alignSelf: leftSpace > rightSpace ? "flex-start" as const : "flex-end" as const,
    width: Math.min(460, sideSpace - 28),
  } : null;
  const finish = () => {
    setStep(null);
    onFinished(accountId);
    void AsyncStorage.setItem(storageKey, "seen").catch(() => {
      console.warn("Could not save Getting Started preference");
    });
  };

  return (
    <Modal transparent animationType="none" statusBarTranslucent onRequestClose={finish}>
      <View style={styles.overlay} accessibilityViewIsModal>
        {frame ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.shade, { top: 0, left: 0, right: 0, height: frame.y }]} />
            <View style={[styles.shade, { top: frame.y, left: 0, width: frame.x, height: frame.height }]} />
            <View style={[styles.shade, { top: frame.y, left: frame.x + frame.width, right: 0, height: frame.height }]} />
            <View style={[styles.shade, { top: frame.y + frame.height, left: 0, right: 0, bottom: 0 }]} />
            <View testID="getting-started-spotlight" style={[styles.outline, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]} />
          </View>
        ) : <View pointerEvents="none" style={[styles.shade, StyleSheet.absoluteFill]} />}

        <View testID="getting-started-card" style={[
          styles.card,
          height < 480 && styles.compactCard,
          sideCard,
          { marginBottom: Math.max(insets.bottom, height < 480 ? 8 : 16) },
        ]}>
          <View style={styles.headingRow}>
            <Text accessibilityRole="header" style={styles.heading}>Getting started</Text>
            <Text style={styles.stepCount}>Step {step + 1} of {steps.length}</Text>
          </View>
          <View accessibilityLiveRegion="polite" style={styles.copy}>
            <Text style={styles.title}>{current.title}</Text>
            <Text style={styles.detail}>{current.text}</Text>
          </View>
          <View style={styles.buttons}>
            <TouchableOpacity accessibilityRole="button" onPress={finish} style={styles.action}>
              <Text style={styles.link}>Skip tour</Text>
            </TouchableOpacity>
            {step > 0 && <TouchableOpacity accessibilityRole="button" onPress={() => setStep(step - 1)} style={styles.action}>
              <Text style={styles.link}>Back</Text>
            </TouchableOpacity>}
            <TouchableOpacity accessibilityRole="button" style={[styles.action, styles.primary]} onPress={() => {
              if (!lastStep) {
                setStep(step + 1);
                return;
              }
              finish();
              onLogFood();
            }}>
              <Text style={styles.primaryText}>{lastStep ? "Log food" : "Next"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 16 },
  shade: { position: "absolute", backgroundColor: "rgba(8,7,4,0.77)" },
  outline: { position: "absolute", borderRadius: 16, borderWidth: 2, borderColor: Colors.accent },
  card: { width: "100%", maxWidth: 460, gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: Colors.controlBorder, backgroundColor: Colors.surface },
  compactCard: { gap: 8, padding: 12 },
  headingRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  heading: { color: Colors.accent, fontSize: 14, fontWeight: "800" },
  stepCount: { color: Colors.textSecondary, fontSize: 12 },
  copy: { gap: 5 },
  title: { color: Colors.text, fontSize: 20, fontWeight: "800" },
  detail: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 },
  action: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 10 },
  link: { color: Colors.text, fontWeight: "700" },
  primary: { backgroundColor: Colors.accent },
  primaryText: { color: Colors.textOnAccent, fontWeight: "800" },
});
