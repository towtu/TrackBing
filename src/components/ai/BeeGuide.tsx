import type { ReactNode } from "react";
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { BeeMood } from "@/src/lib/beeCoach";
import { Colors } from "@/src/styles/colors";

type BeeMascotSize = "small" | "medium" | "large";

type BeeGuideProps = {
  title: string;
  message: string;
  action?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  mascotSize?: BeeMascotSize;
  mood?: BeeMood;
  style?: StyleProp<ViewStyle>;
};

type MascotFrame = {
  width: number;
  height: number;
};

const MASCOT_FRAME: Record<BeeMascotSize, MascotFrame> = {
  small: { width: 50, height: 76 },
  medium: { width: 74, height: 112 },
  large: { width: 96, height: 144 },
};

const BEE_POWER_MASCOTS: Record<BeeMood, ImageSourcePropType> = {
  inactiveMonth: require("../../../assets/images/bee-power-inactive-month.png"),
  inactiveWeek: require("../../../assets/images/bee-power-inactive-week.png"),
  empty: require("../../../assets/images/bee-power-empty.png"),
  over: require("../../../assets/images/bee-power-over.png"),
  strongProtein: require("../../../assets/images/bee-power-strong-protein.png"),
  lowProtein: require("../../../assets/images/bee-power-low-protein.png"),
  streak: require("../../../assets/images/bee-power-streak.png"),
  under: require("../../../assets/images/bee-power-under.png"),
  steady: require("../../../assets/images/bee-power-pose.png"),
};

export function BeeGuide({
  title,
  message,
  action,
  footer,
  compact = false,
  mascotSize = compact ? "small" : "medium",
  mood = "steady",
  style,
}: BeeGuideProps) {
  return (
    <View style={[styles.card, compact && styles.cardCompact, style]}>
      <BeeMascot mood={mood} size={mascotSize} />
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
  mood = "steady",
  style,
}: {
  size?: BeeMascotSize;
  mood?: BeeMood;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = MASCOT_FRAME[size];
  const source = BEE_POWER_MASCOTS[mood] ?? BEE_POWER_MASCOTS.steady;

  return (
    <View
      style={[
        styles.mascotWrap,
        { width: frame.width, height: frame.height },
        style,
      ]}
    >
      <Image
        source={source}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={[
          styles.mascotImage,
          { width: frame.width, height: frame.height },
        ]}
      />
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
    overflow: "visible",
  },
  mascotImage: {
    flexShrink: 0,
  } satisfies ImageStyle,
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
