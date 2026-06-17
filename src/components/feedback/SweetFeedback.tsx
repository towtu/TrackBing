import {
  CheckCircle,
  Info,
  WarningCircle,
  XCircle,
} from "phosphor-react-native";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "@/src/styles/colors";

export type SweetFeedbackType = "success" | "error" | "warning" | "info";

type SweetFeedbackProps = {
  visible: boolean;
  type?: SweetFeedbackType;
  title: string;
  message?: string;
  confirmText?: string;
  autoDismissMs?: number;
  onClose: () => void;
};

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: WarningCircle,
  info: Info,
} as const;

const COLORS: Record<SweetFeedbackType, string> = {
  success: Colors.success,
  error: Colors.error,
  warning: Colors.accent,
  info: Colors.accentBlue,
};

export function SweetFeedback({
  visible,
  type = "success",
  title,
  message,
  confirmText = "OK",
  autoDismissMs,
  onClose,
}: SweetFeedbackProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const Icon = ICONS[type];
  const tone = COLORS[type];

  useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      scale.setValue(0.92);
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        tension: 180,
        friction: 14,
        useNativeDriver: true,
      }),
    ]).start();

    if (!autoDismissMs) return;
    const timer = setTimeout(onClose, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onClose, opacity, scale, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Animated.View
          style={[
            styles.card,
            {
              borderColor: tone,
              shadowColor: tone,
              transform: [{ scale }],
            },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              {
                backgroundColor:
                  type === "success"
                    ? "rgba(74, 222, 128, 0.14)"
                    : type === "error"
                      ? "rgba(239, 68, 68, 0.16)"
                      : type === "warning"
                        ? "rgba(255, 204, 0, 0.14)"
                        : "rgba(110, 136, 176, 0.16)",
              },
            ]}
          >
            <Icon size={46} color={tone} weight="fill" />
          </View>
          <Text style={styles.title}>{title}</Text>
          {!!message && <Text style={styles.message}>{message}</Text>}
          {!autoDismissMs && (
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: tone }]}
              onPress={onClose}
            >
              <Text
                style={[
                  styles.buttonText,
                  (type === "success" || type === "warning") && {
                    color: Colors.textOnAccent,
                  },
                ]}
              >
                {confirmText}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.74)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: Colors.secondary,
    borderRadius: 22,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: "center",
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 12,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  message: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 22,
  },
  button: {
    minWidth: 132,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 16,
    alignItems: "center",
  },
  buttonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "900",
  },
});
