import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BeeAction } from "./BeeMemories";
import { BeeGroundedAnswer } from "./BeeGroundedAnswer";
import { useResponsive } from "@/src/hooks/useResponsive";
import type { GroundedAnswer } from "@/src/lib/beeChat";
import { Colors, Radii } from "@/src/styles/colors";

/** Read-only search result. Food review and saving use a separate interface. */
export function BeeGroundedAnswerDialog({ answer, onClose, onManual, onScan }: {
  answer: GroundedAnswer | null;
  onClose: () => void;
  onManual: () => void;
  onScan: () => void;
}) {
  const { height } = useResponsive();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={answer !== null} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false} tabIndex={-1}>
        <Pressable
          style={[styles.sheet, { maxHeight: Math.max(280, height * 0.9), paddingBottom: Math.max(16, insets.bottom) }]}
          role="dialog"
          aria-modal
          accessibilityViewIsModal
          accessibilityLabel="Bee live food answer"
          accessible={false}
          tabIndex={-1}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>Bee’s food answer</Text>
            <BeeAction label="Close live answer" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {answer ? <BeeGroundedAnswer answer={answer} /> : null}
            <View style={styles.actions}>
              <BeeAction label="Enter package label" onPress={onManual} />
              <BeeAction label="Scan a barcode" onPress={onScan} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.58)", justifyContent: "flex-end" },
  sheet: { width: "100%", maxWidth: 620, alignSelf: "center", backgroundColor: Colors.secondary, padding: 16, borderTopLeftRadius: Radii.card, borderTopRightRadius: Radii.card, borderWidth: 1, borderColor: Colors.border },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { flex: 1, color: Colors.text, fontSize: 17, fontWeight: "700" },
  content: { gap: 16, paddingTop: 16, paddingBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
