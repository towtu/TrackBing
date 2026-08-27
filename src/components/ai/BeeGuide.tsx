import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  getBeeAccessibilityLabel,
  getBeePose,
  getBeeTapReaction,
  type BeePose,
  type BeeSituation,
} from "@/src/lib/beeCompanion";
import { Colors, Radii } from "@/src/styles/colors";

export type BeeMascotSize = "small" | "medium" | "large";
export type BeeGuideVariant = "dashboard" | "compact" | "chat";

type BeeGuideProps = {
  title: string;
  message: string;
  action?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  mascotSize?: BeeMascotSize;
  situation?: BeeSituation;
  interactive?: boolean;
  variant?: BeeGuideVariant;
  style?: StyleProp<ViewStyle>;
};

type BeeMascotProps = {
  size?: BeeMascotSize;
  situation?: BeeSituation;
  interactive?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

type MascotFrame = {
  width: number;
  height: number;
};

const MASCOT_FRAME: Record<BeeMascotSize, MascotFrame> = {
  small: { width: 54, height: 54 },
  medium: { width: 82, height: 82 },
  large: { width: 116, height: 116 },
};

const BEE_MASCOTS: Record<BeePose, ImageSourcePropType> = {
  greeting: require("../../../assets/images/bee/bee-greeting.png"),
  thinking: require("../../../assets/images/bee/bee-thinking.png"),
  encouraging: require("../../../assets/images/bee/bee-encouraging.png"),
  celebrating: require("../../../assets/images/bee/bee-celebrating.png"),
  caution: require("../../../assets/images/bee/bee-caution.png"),
  resting: require("../../../assets/images/bee/bee-resting.png"),
  searching: require("../../../assets/images/bee/bee-searching.png"),
  success: require("../../../assets/images/bee/bee-success.png"),
};

export function BeeGuide({
  title,
  message,
  action,
  footer,
  compact = false,
  mascotSize = compact ? "small" : "medium",
  situation,
  interactive = true,
  variant = compact ? "compact" : "dashboard",
  style,
}: BeeGuideProps) {
  const activeSituation = situation ?? "greeting";
  const [tapCount, setTapCount] = useState(0);
  const [reaction, setReaction] = useState<string | null>(null);
  const lastTapAt = useRef(0);

  useEffect(() => {
    setTapCount(0);
    setReaction(null);
  }, [activeSituation, message]);

  const handleMascotPress = () => {
    const now = Date.now();
    if (now - lastTapAt.current < 450) return;
    lastTapAt.current = now;

    setReaction(getBeeTapReaction(activeSituation, tapCount));
    setTapCount((current) => Math.min(current + 1, 4));
  };

  return (
    <View
      style={[
        styles.card,
        variant === "compact" && styles.cardCompact,
        variant === "chat" && styles.cardChat,
        style,
      ]}
    >
      <BeeMascot
        interactive={interactive}
        onPress={interactive ? handleMascotPress : undefined}
        situation={activeSituation}
        size={mascotSize}
      />
      <View style={styles.content}>
        <View
          style={[
            styles.bubble,
            variant === "compact" && styles.bubbleCompact,
            variant === "chat" && styles.bubbleChat,
          ]}
        >
          {variant !== "chat" ? <View style={styles.bubbleTail} /> : null}
          <Text style={styles.speaker}>Bee</Text>
          <Text
            style={[
              styles.title,
              variant === "compact" && styles.titleCompact,
              variant === "chat" && styles.titleChat,
            ]}
          >
            {title}
          </Text>
          <Text
            style={[
              styles.message,
              variant === "compact" && styles.messageCompact,
            ]}
          >
            {message}
          </Text>
          {reaction ? (
            <Text accessibilityLiveRegion="polite" style={styles.reaction}>
              {reaction}
            </Text>
          ) : null}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

export function BeeMascot({
  size = "medium",
  situation,
  interactive = false,
  onPress,
  style,
}: BeeMascotProps) {
  const activeSituation = situation ?? "greeting";
  const nextPose = getBeePose(activeSituation);
  const [displayedPose, setDisplayedPose] = useState(nextPose);
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const frame = MASCOT_FRAME[size];

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    opacity.stopAnimation();
    if (reduceMotion || nextPose === displayedPose) {
      setDisplayedPose(nextPose);
      opacity.setValue(1);
      return;
    }

    const fadeOut = Animated.timing(opacity, {
      toValue: 0,
      duration: 90,
      useNativeDriver: true,
    });
    fadeOut.start(({ finished }) => {
      if (!finished) return;
      setDisplayedPose(nextPose);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 90,
        useNativeDriver: true,
      }).start();
    });

    return () => opacity.stopAnimation();
  }, [displayedPose, nextPose, opacity, reduceMotion]);

  useEffect(() => {
    bob.stopAnimation();
    bob.setValue(0);
    if (reduceMotion || activeSituation !== "searching") return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: -3,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      bob.setValue(0);
    };
  }, [activeSituation, bob, reduceMotion]);

  const animatePress = (pressed: boolean) => {
    if (reduceMotion) return;
    pressScale.stopAnimation();
    if (pressed) {
      Animated.timing(pressScale, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(pressScale, {
      toValue: 1,
      tension: 220,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  const mascot = (
    <Animated.View
      style={[
        styles.mascotWrap,
        {
          width: frame.width,
          height: frame.height,
          opacity,
          transform: [{ translateY: bob }, { scale: pressScale }],
        },
        style,
      ]}
    >
      <Image
        accessible={false}
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        source={BEE_MASCOTS[displayedPose]}
        style={[
          styles.mascotImage,
          { width: frame.width, height: frame.height },
        ]}
      />
    </Animated.View>
  );

  if (!interactive || !onPress) return mascot;

  return (
    <Pressable
      accessibilityHint="Tap to hear another short response"
      accessibilityLabel={getBeeAccessibilityLabel(activeSituation)}
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress}
      onPressIn={() => animatePress(true)}
      onPressOut={() => animatePress(false)}
    >
      {mascot}
    </Pressable>
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
  cardChat: {
    alignItems: "flex-start",
    gap: 8,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  bubbleCompact: {
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  bubbleChat: {
    borderRadius: Radii.inner,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  bubbleTail: {
    position: "absolute",
    left: -6,
    top: 20,
    width: 10,
    height: 10,
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    transform: [{ rotate: "45deg" }],
  },
  speaker: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginBottom: 3,
  },
  title: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  titleCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  titleChat: {
    fontSize: 13,
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
  reaction: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
    marginTop: 8,
  },
  footer: {
    marginTop: 10,
  },
  action: {
    alignItems: "flex-start",
    marginTop: 10,
  },
});
