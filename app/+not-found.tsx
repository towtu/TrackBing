import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/styles/colors";
import { LegalLinks } from "@/src/components/legal/LegalLinks";

export default function NotFoundRoute() {
  return <View style={styles.screen}>
    <Stack.Screen options={{ title: "Page not found — TrackBing" }} />
    <Text style={styles.brand}>TRACKBING</Text>
    <Text style={styles.code}>404</Text>
    <Text role="heading" aria-level={1} style={styles.title}>This page couldn&apos;t be found</Text>
    <Text style={styles.body}>The link may have changed. Return to TrackBing to continue.</Text>
    <Link href="/" style={styles.button} accessibilityLabel="Return to TrackBing">Back to TrackBing</Link>
    <LegalLinks />
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: Colors.primary },
  brand: { color: Colors.accent, letterSpacing: 2, fontWeight: "800", fontSize: 12, marginBottom: 24 },
  code: { color: Colors.accent, fontSize: 56, fontWeight: "800", marginBottom: 12 },
  title: { color: Colors.text, fontSize: 24, textAlign: "center", fontWeight: "700", marginBottom: 12 },
  body: { color: Colors.textSecondary, fontSize: 16, lineHeight: 24, maxWidth: 400, textAlign: "center", marginBottom: 24 },
  button: { backgroundColor: Colors.accent, color: Colors.textOnAccent, borderRadius: 10, padding: 16, fontSize: 16, fontWeight: "700", marginBottom: 16 },
});
