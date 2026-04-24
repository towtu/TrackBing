import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter, useFocusEffect } from "expo-router";
import { Keyboard, Lightning, X } from "phosphor-react-native";
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
import { NATIVE_BARCODE_TYPES } from "@/src/constants/barcodeFormats";
import NotFoundSheet from "@/src/components/scan/NotFoundSheet";
import ManualEntrySheet from "@/src/components/scan/ManualEntrySheet";

export default function ScanPage() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [torch, setTorch] = useState(false);

  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [notFoundModalVisible, setNotFoundModalVisible] = useState(false);
  const [notFoundMessage, setNotFoundMessage] = useState("");

  const isWeb = Platform.OS === "web";

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setLoading(false);
    }, [])
  );

  // On native, wait for camera permissions
  if (!isWeb) {
    if (!permission) return <View />;
    if (!permission.granted) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>
            Camera access needed to scan foods.
          </Text>
          <TouchableOpacity
            onPress={requestPermission}
            style={styles.permissionBtn}
          >
            <Text style={styles.btnText}>Enable Camera</Text>
          </TouchableOpacity>
        </View>
      );
    }
  }

  const processBarcode = async (code: string) => {
    if (loading) return;
    setLoading(true);
    setManualModalVisible(false);

    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
      );
      const json = await response.json();

      if (json.status === 1 && json.product) {
        const p = json.product;
        const n = p.nutriments || {};

        const calories =
          n["energy-kcal_100g"] || n["energy-kcal"] || n["energy_value"] || 0;
        const protein = n.proteins_100g || n.proteins || 0;
        const carbs = n.carbohydrates_100g || n.carbohydrates || 0;
        const fat = n.fat_100g || n.fat || 0;

        const servingQty = p.serving_quantity || 100;

        // ✅ NEW: Detect if the item is a liquid (like Coke)
        const isLiquid =
          p.product_quantity_unit === "ml" ||
          p.product_quantity_unit === "cl" ||
          p.product_quantity_unit === "l";
        const initialUnit = isLiquid ? "ml" : "g";

        router.replace({
          pathname: "/(tabs)/add",
          params: {
            code: code,
            initialName: p.product_name || "Unknown Product",
            initialCal: calories,
            initialProt: protein,
            initialCarbs: carbs,
            initialFat: fat,
            brand: p.brands || "Packaged Item",
            initialWeight: servingQty.toString(),
            initialUnit: initialUnit, // ✅ Pass "ml" if it's a liquid!
          },
        });
      } else {
        setNotFoundMessage("We couldn't find this barcode in our database.");
        setNotFoundModalVisible(true);
        setLoading(false);
      }
    } catch (error) {
      setNotFoundMessage("Could not reach server. Check your connection.");
      setNotFoundModalVisible(true);
      setLoading(false);
    }
  };

  const handleWebBarcode = useCallback(
    (data: string) => {
      if (!scanned && !loading) {
        setScanned(true);
        processBarcode(data);
      }
    },
    [scanned, loading]
  );

  return (
    <View style={styles.container}>
      {isWeb ? (
        <WebBarcodeScanner
          onBarcodeScanned={handleWebBarcode}
          active={!scanned}
        />
      ) : (
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: NATIVE_BARCODE_TYPES }}
          onMountError={(e) => console.warn("CameraView mount error:", e)}
          onBarcodeScanned={
            scanned
              ? undefined
              : ({ data }) => {
                  setScanned(true);
                  processBarcode(data);
                }
          }
        />
      )}

      <View style={styles.overlay}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <X size={24} color="white" />
          </TouchableOpacity>
          <View style={{ flexDirection: "row", gap: 15 }}>
            <TouchableOpacity
              onPress={() => setManualModalVisible(true)}
              style={styles.iconBtn}
            >
              <Keyboard size={24} color="white" />
            </TouchableOpacity>
            {!isWeb && (
              <TouchableOpacity
                onPress={() => setTorch(!torch)}
                style={[
                  styles.iconBtn,
                  torch && { backgroundColor: Colors.accent },
                ]}
              >
                <Lightning
                  size={24}
                  color={torch ? "black" : "white"}
                  weight="fill"
                />
              </TouchableOpacity>
            )}
          </View>
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
        onChange={setManualCode}
        onClose={() => setManualModalVisible(false)}
        onSubmit={() => processBarcode(manualCode)}
      />

      <NotFoundSheet
        visible={notFoundModalVisible}
        message={notFoundMessage}
        onScanAgain={() => {
          setNotFoundModalVisible(false);
          setScanned(false);
        }}
        onCreateManually={() => {
          setNotFoundModalVisible(false);
          router.replace("/create-food");
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
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  permissionText: { color: "white", marginBottom: 20 },
  permissionBtn: {
    backgroundColor: Colors.accent,
    padding: 10,
    borderRadius: 10,
  },
  btnText: { fontWeight: "bold" },
});
