import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { Colors } from "@/src/styles/colors";

type BeeMascotSize = "small" | "medium" | "large";

type BeeGuideProps = {
  title: string;
  message: string;
  action?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  mascotSize?: BeeMascotSize;
  style?: StyleProp<ViewStyle>;
};

const MASCOT_SIZE: Record<BeeMascotSize, number> = {
  small: 54,
  medium: 70,
  large: 86,
};

export function BeeGuide({
  title,
  message,
  action,
  footer,
  compact = false,
  mascotSize = compact ? "small" : "medium",
  style,
}: BeeGuideProps) {
  return (
    <View style={[styles.card, compact && styles.cardCompact, style]}>
      <BeeMascot size={mascotSize} />
      <View style={styles.content}>
        <View style={[styles.bubble, compact && styles.bubbleCompact]}>
          <View style={styles.bubbleTail} />
          <Text style={styles.speaker}>Bee</Text>
          <Text style={[styles.title, compact && styles.titleCompact]}>
            {title}
          </Text>
          <Text style={[styles.message, compact && styles.messageCompact]}>
            {message}
          </Text>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

export function BeeMascot({
  size = "medium",
  style,
}: {
  size?: BeeMascotSize;
  style?: StyleProp<ViewStyle>;
}) {
  const dimension = MASCOT_SIZE[size];

  return (
    <View style={[styles.mascotWrap, { width: dimension, height: dimension }, style]}>
      <Svg width={dimension} height={dimension} viewBox="0 0 96 96">
        <Defs>
          <LinearGradient id="beeBody" x1="28" y1="18" x2="70" y2="78">
            <Stop offset="0" stopColor="#ffe066" />
            <Stop offset="1" stopColor={Colors.accent} />
          </LinearGradient>
          <LinearGradient id="wing" x1="18" y1="18" x2="74" y2="60">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0.45" />
          </LinearGradient>
        </Defs>

        <Ellipse
          cx="25"
          cy="38"
          rx="15"
          ry="20"
          fill="url(#wing)"
          stroke="rgba(255,255,255,0.72)"
          strokeWidth="2"
          transform="rotate(-24 25 38)"
        />
        <Ellipse
          cx="71"
          cy="38"
          rx="15"
          ry="20"
          fill="url(#wing)"
          stroke="rgba(255,255,255,0.72)"
          strokeWidth="2"
          transform="rotate(24 71 38)"
        />

        <Path
          d="M29 42C29 25 38 16 48 16C58 16 67 25 67 42V60C67 74 58 82 48 82C38 82 29 74 29 60V42Z"
          fill="url(#beeBody)"
          stroke="#0f0f12"
          strokeWidth="3"
        />
        <Rect x="30" y="45" width="36" height="8" rx="4" fill="#121214" />
        <Rect x="31" y="61" width="34" height="8" rx="4" fill="#121214" />

        <Path
          d="M34 28C38 22 43 20 48 20C53 20 58 22 62 28V36H34V28Z"
          fill="#121214"
        />
        <Path
          d="M36 28C40 24 44 23 48 23C52 23 56 24 60 28"
          fill="none"
          stroke={Colors.accent}
          strokeLinecap="round"
          strokeWidth="3"
        />

        <G>
          <Path
            d="M39 16C35 9 30 8 27 12"
            fill="none"
            stroke="#121214"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <Path
            d="M57 16C61 9 66 8 69 12"
            fill="none"
            stroke="#121214"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <Circle cx="26" cy="12" r="4" fill={Colors.accent} stroke="#121214" strokeWidth="2" />
          <Circle cx="70" cy="12" r="4" fill={Colors.accent} stroke="#121214" strokeWidth="2" />
        </G>

        <Circle cx="41" cy="38" r="4" fill="#121214" />
        <Circle cx="55" cy="38" r="4" fill="#121214" />
        <Circle cx="42.5" cy="36.5" r="1.4" fill="#ffffff" />
        <Circle cx="56.5" cy="36.5" r="1.4" fill="#ffffff" />
        <Path
          d="M42 49C45 52 51 52 54 49"
          fill="none"
          stroke="#121214"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardCompact: {
    gap: 10,
  },
  mascotWrap: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  bubble: {
    position: "relative",
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.22)",
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  bubbleCompact: {
    borderRadius: 15,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  bubbleTail: {
    position: "absolute",
    left: -7,
    top: 22,
    width: 12,
    height: 12,
    backgroundColor: Colors.secondary,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.22)",
    transform: [{ rotate: "45deg" }],
  },
  speaker: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 4,
  },
  title: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
    letterSpacing: 0,
  },
  titleCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  message: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  messageCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  footer: {
    marginTop: 10,
  },
  action: {
    alignItems: "flex-start",
    marginTop: 10,
  },
});
