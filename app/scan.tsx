import { useRouter, useFocusEffect } from "expo-router";
import { Keyboard, X } from "@/src/components/icons";
import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "@/src/styles/colors";
import WebBarcodeScanner from "@/src/components/WebBarcodeScanner";
import AndroidBarcodeScanner from "@/src/components/scan/AndroidBarcodeScanner";
import NotFoundSheet from "@/src/components/scan/NotFoundSheet";
import ManualEntrySheet from "@/src/components/scan/ManualEntrySheet";
import { sanitizeBarcodeInput } from "@/src/lib/barcodes";
import { resolveBarcode } from "@/src/lib/foodSearch";

export default function ScanPage() {
  const router = useRouter();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [notFoundModalVisible, setNotFoundModalVisible] = useState(false);
  const [notFoundTitle, setNotFoundTitle] = useState("");
  const [notFoundMessage, setNotFoundMessage] = useState("");
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  const [canCreateMissingFood, setCanCreateMissingFood] = useState(false);

  const isWeb = Platform.OS === "web";

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setLoading(false);
    }, [])
  );

  const processBarcode = useCallback(async (rawCode: string) => {
    if (loading) return;
    setLoading(true);
    setManualModalVisible(false);

    const result = await resolveBarcode(rawCode);
    if (result.ok) {
      const food = result.food;
      const nutriments = food.nutriments || {};
      const initialUnit = food.default_unit || "g";
      const initialWeight =
        food.serving_quantity ||
        (initialUnit === "g" || initialUnit === "ml" ? 100 : 1);

      router.replace({
        pathname: "/(tabs)/add",
        params: {
          code: food.code,
          initialName: food.product_name || "Unknown Product",
          initialCal: nutriments["energy-kcal_100g"] || 0,
          initialProt: nutriments.proteins_100g || 0,
          initialCarbs: nutriments.carbohydrates_100g || 0,
          initialFat: nutriments.fat_100g || 0,
          brand: food.brands || "Packaged Item",
          initialWeight: String(initialWeight),
          initialUnit,
        },
      });
      return;
    }

    const barcode = sanitizeBarcodeInput(rawCode);
    setNotFoundBarcode(result.reason === "not-found" ? barcode : null);
    setCanCreateMissingFood(result.reason === "not-found");
    setNotFoundTitle(
      result.reason === "not-found"
        ? "Product not found"
        : result.reason === "invalid"
          ? "Check barcode"
          : result.reason === "auth-required"
            ? "Sign in required"
            : "Lookup unavailable",
    );
    setNotFoundMessage(
      result.reason === "not-found"
        ? "This barcode is not in Open Food Facts or your My Foods yet."
        : result.reason === "invalid"
          ? "Use a barcode containing 4 to 32 digits."
          : result.reason === "auth-required"
            ? "Sign in again before looking up personal foods."
            : "Could not reach the food database. Check your connection and retry.",
    );
    setNotFoundModalVisible(true);
    setLoading(false);
  }, [loading, router]);

  const handleBarcode = useCallback(
    (data: string) => {
      if (!scanned && !loading) {
        setScanned(true);
        void processBarcode(data);
      }
    },
    [loading, processBarcode, scanned],
  );

  return (
    <View style={styles.container}>
      {isWeb ? (
        <WebBarcodeScanner onBarcodeScanned={handleBarcode} active={!scanned} />
      ) : (
        <AndroidBarcodeScanner onBarcodeScanned={handleBarcode} active={!scanned} />
      )}

      <View style={styles.overlay}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <X size={24} color="white" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setManualModalVisible(true)}
            style={styles.iconBtn}
          >
            <Keyboard size={24} color="white" />
          </TouchableOpacity>
        </View>

        <View style={styles.scanArea}>
          <View style={styles.reticle}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
            {loading && (
              <ActivityIndicator size="large" color={Colors.accent} />
            )}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.hintText}>Scan barcode or type it manually</Text>
        </View>
      </View>

      <ManualEntrySheet
        visible={manualModalVisible}
        value={manualCode}
        onChange={(value) => setManualCode(sanitizeBarcodeInput(value))}
        onClose={() => setManualModalVisible(false)}
        onSubmit={() => processBarcode(manualCode)}
      />

      <NotFoundSheet
        visible={notFoundModalVisible}
        title={notFoundTitle}
        message={notFoundMessage}
        canCreate={canCreateMissingFood}
        onScanAgain={() => {
          setNotFoundModalVisible(false);
          setScanned(false);
        }}
        onCreateManually={() => {
          if (!notFoundBarcode) return;
          setNotFoundModalVisible(false);
          router.replace({
            pathname: "/create-food",
            params: { barcode: notFoundBarcode },
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  overlay: { flex: 1, justifyContent: "space-between" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  iconBtn: {
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 15,
  },
  scanArea: { flex: 1, justifyContent: "center", alignItems: "center" },
  reticle: {
    width: 260,
    height: 200,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: { paddingBottom: 60, alignItems: "center" },
  hintText: { color: "white", opacity: 0.7, fontSize: 14, fontWeight: "500" },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: Colors.accent,
    borderWidth: 0,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 20,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 20,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 20,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 20,
  },
});
