import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
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
  type BeePose,
  type BeeSituation,
} from "@/src/lib/beeCompanion";
import { useBeeCompanion } from "./BeeCompanionProvider";
import { useBeeMotion } from "./useBeeMotion";
import { beeMotionProfile } from "@/src/lib/beeCompanionContext";
import { openBee } from "@/src/lib/beeEvents";
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
  showMascot?: boolean;
  nutritionDetail?: string;
  situation?: BeeSituation;
  interactive?: boolean;
  variant?: BeeGuideVariant;
  style?: StyleProp<ViewStyle>;
};

type BeeMascotProps = {
  size?: BeeMascotSize;
  active?: boolean;
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
  showMascot = false,
  nutritionDetail,
  situation,
  interactive = true,
  variant = compact ? "compact" : "dashboard",
  style,
}: BeeGuideProps) {
  const handleMascotPress = openBee;

  return (
    <View
      style={[
        styles.card,
        variant === "compact" && styles.cardCompact,
        variant === "chat" && styles.cardChat,
        style,
      ]}
    >
      {showMascot ? <BeeMascot
        interactive={interactive}
        onPress={interactive ? handleMascotPress : undefined}
        situation={situation}
        size={mascotSize}
      /> : null}
      <View style={styles.content}>
        <View
          style={[
            styles.bubble,
            variant === "compact" && styles.bubbleCompact,
            variant === "chat" && styles.bubbleChat,
          ]}
        >
          {showMascot && variant !== "chat" ? <View style={styles.bubbleTail} /> : null}
          {interactive ? <Pressable accessibilityRole="button" accessibilityLabel="Open Bee chat" onPress={openBee} style={styles.openChat}><Text style={styles.speaker}>Ask Bee</Text></Pressable> : <Text style={styles.speaker}>Bee</Text>}
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
          {nutritionDetail ? <Text style={styles.nutritionDetail}>{nutritionDetail}</Text> : null}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

export function BeeMascot({
  size = "medium",
  active = true,
  situation,
  interactive = false,
  onPress,
  style,
}: BeeMascotProps) {
  const companion = useBeeCompanion();
  const activeSituation = situation ?? companion.situation;
  const nextPose = getBeePose(activeSituation);
  const [displayedPose, setDisplayedPose] = useState(nextPose);
  const displayedRef = useRef(nextPose);
  const viewport = useRef<View | null>(null);
  const { reduced, active: onScreen } = useBeeMotion(viewport);
  const moving = active && onScreen && !reduced && companion.motionEnabled;
  const opacity = useRef(new Animated.Value(1)).current;
  const movement = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const frame = MASCOT_FRAME[size];
  const profile = beeMotionProfile(nextPose);
  const useNativeDriver = Platform.OS !== "web";

  useEffect(() => {
    opacity.stopAnimation();
    if (!moving || nextPose === displayedRef.current) {
      displayedRef.current = nextPose;
      setDisplayedPose(nextPose);
      opacity.setValue(1);
      return;
    }
    const transition = Animated.sequence([
      Animated.timing(opacity, { toValue: 0, duration: 90, isInteraction: false, useNativeDriver }),
      Animated.timing(opacity, { toValue: 1, duration: 120, isInteraction: false, useNativeDriver }),
    ]);
    // Switch the asset while invisible; a state update must not cancel the fade-in.
    const subscription = opacity.addListener(({ value }) => {
      if (value === 0 && displayedRef.current !== nextPose) {
        displayedRef.current = nextPose;
        setDisplayedPose(nextPose);
      }
    });
    transition.start();
    return () => { transition.stop(); opacity.removeListener(subscription); };
  }, [moving, nextPose, opacity, useNativeDriver]);

  useEffect(() => {
    movement.stopAnimation(); movement.setValue(0); pressScale.setValue(1);
    if (!moving) return;
    const config = { duration: profile.duration, easing: Easing.inOut(Easing.sin), isInteraction: false, useNativeDriver };
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(movement, { ...config, toValue: 1 }),
      Animated.timing(movement, { ...config, toValue: 0 }),
    ]));
    loop.start();
    return () => { loop.stop(); movement.setValue(0); };
  }, [moving, movement, pressScale, profile.duration, nextPose, useNativeDriver]);

  const animatePress = (pressed: boolean) => {
    if (!moving) return;
    Animated.timing(pressScale, { toValue: pressed ? 0.97 : 1, duration: pressed ? 100 : 150, easing: Easing.out(Easing.cubic), useNativeDriver }).start();
  };

  const mascot = (
    <Animated.View
      ref={viewport}
      testID={`bee-mascot-${nextPose}`}
      style={[
        styles.mascotWrap,
        {
          width: frame.width,
          height: frame.height,
          opacity,
          transform: [
            { translateX: movement.interpolate({ inputRange: [0, 1], outputRange: [0, profile.x] }) },
            { translateY: movement.interpolate({ inputRange: [0, 1], outputRange: [0, profile.y] }) },
            { rotate: movement.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${profile.tilt}deg`] }) },
            { scale: pressScale },
          ],
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
      accessibilityHint="Open your Bee conversation"
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
  nutritionDetail: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  openChat: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4, marginTop: -8 },
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
