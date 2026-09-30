import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { BeeAction } from "./BeeMemories";
import { BeeGroundedSuggestions } from "./BeeGroundedAnswer.suggestions";
import { isBeeGroundedAnswer } from "./BeeGroundedAnswer.shared";
import { getBeeSourceUrl, type GroundedAnswer } from "@/src/lib/beeChat";
import { Colors } from "@/src/styles/colors";

/** Only the currently returned answer lives here; it is never saved locally. */
export function BeeGroundedAnswer({ answer }: { answer: GroundedAnswer }) {
  const [linkError, setLinkError] = useState(false);
  if (!isBeeGroundedAnswer(answer)) return null;

  const openSource = async (value: string) => {
    const url = getBeeSourceUrl(value);
    if (!url) return;
    try {
      if (Platform.OS === "web") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
      setLinkError(false);
    } catch {
      setLinkError(true);
    }
  };

  return (
    <View style={styles.answer}>
      <Text style={styles.label}>Live answer</Text>
      <Text selectable style={styles.text}>{answer.text}</Text>
      <View style={styles.sources}>
        <Text accessibilityRole="header" style={styles.label}>Sources</Text>
        {answer.citations.map((citation, index) => (
          <BeeAction
            key={`${citation.url}:${citation.startIndex}:${citation.endIndex}:${index}`}
            label={`${index + 1}. ${citation.title || new URL(citation.url).hostname}`}
            accessibilityLabel={`Open source ${index + 1}: ${citation.title || citation.url}`}
            role="link"
            onPress={() => void openSource(citation.url)}
            style={styles.source}
          />
        ))}
      </View>
      {answer.searchSuggestionsHtml.map((html, index) => (
        <BeeGroundedSuggestions key={index} html={html} onOpenUrl={(url) => void openSource(url)} />
      ))}
      {linkError ? <Text accessibilityLiveRegion="polite" style={styles.note}>Couldn’t open the page. Try the link again.</Text> : null}
      <Text style={styles.note}>Use a matching food record or your package label to review a portion for your diary.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  answer: { gap: 12 },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  text: { color: Colors.text, fontSize: 14, lineHeight: 21 },
  sources: { gap: 6 },
  source: { alignSelf: "stretch", justifyContent: "flex-start", maxWidth: "100%" },
  note: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
});
