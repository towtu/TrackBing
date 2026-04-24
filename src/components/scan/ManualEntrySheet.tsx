import { MagnifyingGlass, X } from "phosphor-react-native";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "@/src/styles/colors";

interface ManualEntrySheetProps {
  visible: boolean;
  value: string;
  onChange: (text: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export default function ManualEntrySheet({
  visible,
  value,
  onChange,
  onClose,
  onSubmit,
}: ManualEntrySheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Enter Barcode</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={24} color="white" />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="e.g. 4800016..."
            placeholderTextColor="#666"
            keyboardType="numeric"
            value={value}
            onChangeText={onChange}
            autoFocus
          />
          <TouchableOpacity style={styles.searchBtn} onPress={onSubmit}>
            <MagnifyingGlass size={20} color="black" weight="bold" />
            <Text style={styles.searchBtnText}>Search Product</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "flex-end",
  },
  content: {
    backgroundColor: "#1A1A1A",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 25,
    paddingBottom: 50,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: { color: "white", fontSize: 18, fontWeight: "bold" },
  input: {
    backgroundColor: "#333",
    color: "white",
    padding: 15,
    borderRadius: 12,
    fontSize: 18,
    marginVertical: 20,
    borderWidth: 1,
    borderColor: "#444",
  },
  searchBtn: {
    backgroundColor: Colors.accent,
    padding: 15,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  searchBtnText: { color: "black", fontWeight: "bold", fontSize: 16 },
});
