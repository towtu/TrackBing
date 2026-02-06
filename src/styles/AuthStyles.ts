// src/styles/AuthStyles.ts
import { StyleSheet } from "react-native";
import { Colors } from "./colors";

export const AuthStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: Colors.primary,
  },
  formContainer: {
    width: "100%",
    maxWidth: 400,
    padding: 30,
    borderRadius: 20,
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: "#333",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  label: {
    marginBottom: 8,
    fontWeight: "600",
    color: Colors.accent,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  inputContainer: {
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    backgroundColor: Colors.inputBg,
    color: Colors.text,
    fontSize: 16,
  },
  buttonContainer: {
    marginTop: 1,
    gap: 15,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnText: {
    color: Colors.textOnAccent,
    fontWeight: "bold",
    fontSize: 16,
  },
  toggleContainer: {
    marginTop: 20,
    alignItems: "center",
  },
  toggleText: {
    color: "#888",
    fontSize: 14,
  },
  toggleTextBold: {
    color: Colors.accent,
    fontWeight: "bold",
  },

  // --- NEW MODAL STYLES ---
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)", // Dark transparent background
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    maxWidth: 340,
    backgroundColor: "#18181b", // Match Card Color
    borderRadius: 20,
    padding: 25,
    borderWidth: 2,
    borderColor: Colors.accent, // Yellow Border
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 20,
  },
  modalTitle: {
    color: Colors.accent,
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  modalMessage: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 25,
    lineHeight: 22,
  },
  modalButton: {
    backgroundColor: Colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 25,
    width: "100%",
  },
  modalButtonText: {
    color: "black",
    fontWeight: "bold",
    fontSize: 16,
    textAlign: "center",
  },
});
