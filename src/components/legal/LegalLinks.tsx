import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/styles/colors";

export function LegalLinks() {
  return <View style={styles.links}>
    <Link href="/privacy" accessibilityLabel="Read TrackBing privacy policy" style={styles.link}><Text>Privacy policy</Text></Link>
    <Link href="/terms" accessibilityLabel="Read TrackBing terms and conditions" style={styles.link}><Text>Terms and conditions</Text></Link>
  </View>;
}
const styles = StyleSheet.create({
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  link: { color: Colors.textSecondary, paddingVertical: 14, paddingHorizontal: 8, textDecorationLine: "underline", fontSize: 14 },
});
