import { StyleSheet } from "react-native";
import { Colors } from "./colors";

export const DashboardStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary, // Uses your new True Black
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 100,
  },
  summaryCard: {
    backgroundColor: Colors.secondary,
    borderRadius: 20,
    padding: 25,
    marginBottom: 25,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  summaryTitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  bigNumber: {
    color: Colors.accent,
    fontSize: 48,
    fontWeight: "bold",
    marginBottom: 5,
  },
  macroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  logItem: {
    backgroundColor: Colors.secondary,
    padding: 15,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  foodName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  dateText: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  caloriesText: {
    color: Colors.accent,
    fontWeight: "bold",
    fontSize: 16,
  },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 40,
    fontSize: 16,
  },
});
