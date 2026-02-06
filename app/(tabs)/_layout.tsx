// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import React from "react";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false, // Hides Top Header
        tabBarStyle: {
          display: "none", // Hides Bottom Tab Bar
        },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="add" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
