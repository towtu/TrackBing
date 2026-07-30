import { MagnifyingGlass, X } from "phosphor-react-native";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "@/src/styles/colors";

interface NotFoundSheetProps {
  visible: boolean;
  title: string;
  message: string;
  canCreate: boolean;
  onScanAgain: () => void;
  onCreateManually: () => void;
}

export default function NotFoundSheet({
  visible,
  title,
  message,
  canCreate,
  onScanAgain,
  onCreateManually,
}: NotFoundSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onScanAgain}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onScanAgain}
        />
        <View style={styles.sheet}>
          <View style={styles.drag} />
          <View style={styles.icon}>
            <MagnifyingGlass size={32} color={Colors.accent} weight="fill" />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{message}</Text>
          <View style={styles.btnRow}>
            {canCreate ? (
              <>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.btnSecondary}
                  onPress={onScanAgain}
                >
                  <Text style={styles.btnSecondaryText}>Scan again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.btnPrimary}
                  onPress={onCreateManually}
                >
                  <Text style={styles.btnPrimaryText}>Create this food</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.btnPrimary}
                onPress={onScanAgain}
              >
                <Text style={styles.btnPrimaryText}>Try again</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
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
  drag: {
    width: 48,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 24,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.accentGlow,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 32,
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: "center",
  },
  btnSecondaryText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: Colors.accent,
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: "center",
    elevation: 6,
  },
  btnPrimaryText: {
    color: Colors.textOnAccent,
    fontSize: 16,
    fontWeight: "800",
  },
});
