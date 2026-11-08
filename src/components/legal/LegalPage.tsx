import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/styles/colors";
import { siteConfig } from "@/src/lib/siteConfig";
import { LegalLinks } from "./LegalLinks";

export type LegalSection = { heading: string; paragraphs: string[] };
export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
    <View style={styles.content}>
      <Link href="/" style={styles.back} accessibilityLabel="Return to TrackBing">‹ Back to TrackBing</Link>
      <Text style={styles.brand}>TRACKBING</Text>
      <Text role="heading" aria-level={1} style={styles.title}>{title}</Text>
      {!siteConfig.legalReviewed && <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Draft — operator review pending</Text>
        <Text style={styles.body}>This describes the current app. Legal operator details, privacy contact, retention decisions, and final terms still need review before public launch.</Text>
      </View>}
      <Text style={styles.body}>{intro}</Text>
      <Text style={styles.updated}>Implementation draft updated 27 September 2026.</Text>
      {sections.map(section => <View key={section.heading} style={styles.section}>
        <Text role="heading" aria-level={2} style={styles.heading}>{section.heading}</Text>
        {section.paragraphs.map(paragraph => <Text key={paragraph} selectable style={styles.body}>{paragraph}</Text>)}
      </View>)}
      <View style={styles.section}>
        <Text role="heading" aria-level={2} style={styles.heading}>Operator and contact</Text>
        <Text style={styles.body}>{siteConfig.operator ? `Operator: ${siteConfig.operator}.` : "The legal operator has not yet been published. This must be completed before launch."}</Text>
        {siteConfig.privacyEmail ? <Link href={`mailto:${siteConfig.privacyEmail}`} style={styles.contact} accessibilityLabel="Email TrackBing's privacy contact">{siteConfig.privacyEmail}</Link>
          : <Text style={styles.body}>A verified support and privacy contact has not yet been published. Do not send sensitive information through an unverified address.</Text>}
      </View>
      <LegalLinks />
    </View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.primary },
  scroll: { paddingHorizontal: 24, paddingVertical: 24, alignItems: "center" },
  content: { width: "100%", maxWidth: 760 },
  back: { color: Colors.accent, paddingVertical: 14, marginBottom: 24, alignSelf: "flex-start", fontSize: 16 },
  brand: { color: Colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 2, marginBottom: 12 },
  title: { color: Colors.text, fontSize: 32, fontWeight: "800", marginBottom: 24 },
  notice: { borderWidth: 1, borderColor: Colors.accent, borderRadius: 10, padding: 16, marginBottom: 24, gap: 8 },
  noticeTitle: { color: Colors.accent, fontSize: 16, fontWeight: "700" },
  body: { color: Colors.text, fontSize: 16, lineHeight: 26, marginBottom: 12 },
  updated: { color: Colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 12 },
  section: { marginTop: 24 },
  heading: { color: Colors.text, fontSize: 21, fontWeight: "700", marginBottom: 12 },
  contact: { color: Colors.accent, paddingVertical: 14, alignSelf: "flex-start", fontSize: 16 },
});
