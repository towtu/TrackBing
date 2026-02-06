import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { Keyboard, Lightning, MagnifyingGlass, X } from "phosphor-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "../src/styles/colors";

export default function ScanPage() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [torch, setTorch] = useState(false);

  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualCode, setManualCode] = useState("");

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

  const processBarcode = async (code: string) => {
    if (loading) return;
    setLoading(true);
    setManualModalVisible(false);

    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
      );
      const json = await response.json();

      if (json.status === 1) {
        const p = json.product;
        const n = p.nutriments || {};

        // ✅ FIXED: Checks multiple variations of data keys
        // Some products use 'energy-kcal', some use 'energy-kcal_100g', some 'calories'
        const calories =
          n["energy-kcal_100g"] || n["energy-kcal"] || n["energy_value"] || 0;
        const protein = n.proteins_100g || n.proteins || 0;
        const carbs = n.carbohydrates_100g || n.carbohydrates || 0;
        const fat = n.fat_100g || n.fat || 0;

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
          },
        });
      } else {
        Alert.alert("Not Found", "We couldn't find this item.", [
          {
            text: "Scan Again",
            onPress: () => {
              setScanned(false);
              setLoading(false);
            },
          },
          {
            text: "Create Manually",
            onPress: () => router.replace("/create-food"),
          },
        ]);
      }
    } catch (error) {
      Alert.alert("Error", "Check internet connection.");
      setScanned(false);
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={torch}
        onBarcodeScanned={
          scanned
            ? undefined
            : ({ data }) => {
                setScanned(true);
                processBarcode(data);
              }
        }
      />

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

      <Modal
        visible={manualModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setManualModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <Text style={styles.modalTitle}>Enter Barcode</Text>
              <TouchableOpacity onPress={() => setManualModalVisible(false)}>
                <X size={24} color="white" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="e.g. 4800016..."
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={manualCode}
              onChangeText={setManualCode}
              autoFocus
            />
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={() => processBarcode(manualCode)}
            >
              <MagnifyingGlass size={20} color="black" weight="bold" />
              <Text style={styles.searchBtnText}>Search Product</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1A1A1A",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 25,
    paddingBottom: 50,
  },
  modalTitle: { color: "white", fontSize: 18, fontWeight: "bold" },
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
