// src/styles/auth.ts
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
    maxWidth: 420,
    padding: 28,
    borderRadius: 24,
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  label: {
    marginBottom: 7,
    fontWeight: "700",
    color: Colors.textSecondary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  inputContainer: {
    marginBottom: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 14,
    backgroundColor: Colors.inputBg,
    color: Colors.text,
    fontSize: 16,
  },
  buttonContainer: {
    marginTop: 6,
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    color: Colors.textOnAccent,
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  toggleContainer: {
    marginTop: 20,
    alignItems: "center",
  },
  toggleText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  toggleTextBold: {
    color: Colors.accent,
    fontWeight: "700",
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    maxWidth: 340,
    backgroundColor: Colors.secondary,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
  modalTitle: {
    color: Colors.accent,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center",
  },
  modalMessage: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  modalButton: {
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    width: "100%",
  },
  modalButtonText: {
    color: Colors.textOnAccent,
    fontWeight: "800",
    fontSize: 15,
    textAlign: "center",
  },
});
