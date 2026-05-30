import { useWindowDimensions, Platform } from "react-native";

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  // Desktop breakpoint is 1024px or above on web
  const isDesktop = isWeb && width >= 1024;

  return {
    width,
    height,
    isWeb,
    isDesktop,
    containerStyle: {
      maxWidth: isDesktop ? 1200 : 520,
      width: "100%",
      alignSelf: "center" as const,
    },
  };
}
