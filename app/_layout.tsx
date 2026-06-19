import { Session } from "@supabase/supabase-js";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/src/lib/supabase";
import { Colors } from "@/src/styles/colors";
import ErrorBoundary from "@/src/components/ErrorBoundary";
import AuthRoute from "./auth";
import { useResponsive } from "@/src/hooks/useResponsive";
import DesktopSidebar from "@/src/components/DesktopSidebar";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { isDesktop } = useResponsive();

  useEffect(() => {
    if (Platform.OS === "web") {
      const style = document.createElement("style");
      style.textContent = `
        * { scrollbar-width: thin; scrollbar-color: ${Colors.border} transparent; }
        *::-webkit-scrollbar { width: 8px; height: 8px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: ${Colors.border}; border-radius: 999px; }
        *::-webkit-scrollbar-thumb:hover { background: ${Colors.borderLight}; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.primary,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={isDesktop ? [] : ["top", "left", "right"]}>
          <StatusBar style="light" />

          <View style={[styles.content, isDesktop && { flexDirection: "row" }]}>
            {isDesktop && session && <DesktopSidebar />}
            
            <View style={{ flex: 1, backgroundColor: Colors.primary }}>
              {!session ? (
                <AuthRoute />
              ) : (
                <Stack
                  screenOptions={{
                    headerShown: false,
                    title: "TrackBing", // <--- THIS SETS THE BROWSER TAB NAME
                  }}
                >
                  <Stack.Screen name="(tabs)" />
                </Stack>
              )}
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
  content: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
});
