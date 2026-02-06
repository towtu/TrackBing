// src/pages/AddFoodPage.tsx
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { addFoodLog } from "../api/foodLogs";
import { searchFood } from "../api/openFoodFacts";
import { AddFoodStyles as styles } from "../styles/AddFoodStyles";
import { Colors } from "../styles/colors";
import { ProductResult } from "../types";

export function AddFoodPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    const foods = await searchFood(query);
    setResults(foods);
    setLoading(false);
  };

  const handleAddFood = async (item: ProductResult) => {
    try {
      setLoading(true);

      await addFoodLog({
        name: item.product_name || "Unknown Food",
        calories:
          item.nutriments?.["energy-kcal_serving"] ||
          item.nutriments?.["energy-kcal_100g"] ||
          0,
        protein: item.nutriments?.proteins_100g || 0,
        carbs: item.nutriments?.carbohydrates_100g || 0,
        fat: item.nutriments?.fat_100g || 0,
        barcode: item.code || "",
      });

      Alert.alert("Success", "Food added!");
      router.back();
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.contentContainer}>
        <View style={styles.searchBox}>
          <TextInput
            style={styles.input}
            placeholder="Search food (e.g. 'Apple')"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            placeholderTextColor="#999"
          />
          <TouchableOpacity onPress={handleSearch} style={styles.searchBtn}>
            <Text style={styles.btnText}>Search</Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <ActivityIndicator
            size="large"
            color={Colors.primary}
            style={{ marginTop: 20 }}
          />
        )}

        <FlatList
          data={results}
          keyExtractor={(item) => item.code || Math.random().toString()}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={styles.itemCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>
                  {item.product_name || "Unknown Food"}
                </Text>
                <Text style={styles.itemSub}>
                  {Math.round(item.nutriments?.["energy-kcal_100g"] || 0)} kcal
                  / 100g
                </Text>
              </View>

              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => handleAddFood(item)}
              >
                <Text style={styles.addBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            !loading && query ? (
              <Text
                style={{ textAlign: "center", marginTop: 20, color: "#999" }}
              >
                No results found
              </Text>
            ) : null
          }
        />
      </View>
    </SafeAreaView>
  );
}
