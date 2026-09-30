import { Session } from "@supabase/supabase-js";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/src/lib/supabase";
import { Colors } from "@/src/styles/colors";
import { BeeQuickLog } from "@/src/components/ai/BeeQuickLog";
import ErrorBoundary from "@/src/components/ErrorBoundary";
import AuthRoute from "./auth";
import { useResponsive } from "@/src/hooks/useResponsive";
import DesktopSidebar from "@/src/components/DesktopSidebar";
import { PageMetadata } from "@/src/components/legal/PageMetadata";
import { routeKind } from "@/src/lib/siteConfig";
import { AnalyticsConsentBanner } from "@/src/components/privacy/AnalyticsConsent";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { isDesktop } = useResponsive();
  const pathname = usePathname();
  const kind = routeKind(pathname);
  const accountPage = pathname === "/" || kind === "private";

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
      return () => style.remove();
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let authChanged = false;
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted || authChanged) return;
      if (error) console.warn("Unable to restore sign-in session.");
      setSession(error ? null : session);
      setLoading(false);
    }).catch(() => {
      if (!mounted || authChanged) return;
      console.warn("Unable to restore sign-in session.");
      setSession(null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      authChanged = true;
      setSession(session);
      setLoading(false);
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);


  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={isDesktop ? [] : ["top", "left", "right"]}>
          <StatusBar style="light" />
          <PageMetadata privateAccount={!!session && accountPage} />

          <View style={[styles.content, isDesktop && { flexDirection: "row" }]}>
            {isDesktop && session && accountPage && <DesktopSidebar />}
            
            <View style={{ flex: 1, backgroundColor: Colors.primary }}>
              <Stack
                key={session?.user.id ?? "public"}
                screenOptions={{ headerShown: false, title: "TrackBing" }}
                // Keep the navigator mounted so signed-out legal links work. Wrapping
                // the screen prevents private components from mounting before auth.
                // https://reactnavigation.org/docs/navigator/#screen-layout
                screenLayout={({ children, route }) => {
                  const requiresSession = route.name === "(tabs)" || routeKind("/" + route.name) === "private";
                  if (route.name === "auth" && session && !loading) return <Redirect href="/" />;
                  if (requiresSession && !session) {
                    if (loading && pathname !== "/") return <View style={styles.loading}>
                      <ActivityIndicator size="large" color={Colors.accent} />
                      <Text style={styles.loadingText}>Restoring your sign-in…</Text>
                    </View>;
                    return <AuthRoute />;
                  }
                  return <>{children}</>;
                }}
              >
                <Stack.Screen name="(tabs)" />
              </Stack>
            </View>
            {session && accountPage && <BeeQuickLog key={session.user.id} userId={session.user.id} />}
          </View>
          <AnalyticsConsentBanner pathname={pathname} />
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
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingText: { color: Colors.textSecondary, fontSize: 15 },
  content: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
});
