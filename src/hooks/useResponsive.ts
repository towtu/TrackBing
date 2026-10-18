import { useEffect, useState } from "react";
import { useWindowDimensions, Platform } from "react-native";

export function useResponsive() {
  const dimensions = useWindowDimensions();
  const [hydrated,setHydrated]=useState(Platform.OS !== "web");
  useEffect(()=>setHydrated(true),[]);
  // Static export and the first browser render share one layout; resize after hydration.
  const {width,height}=hydrated ? dimensions : {width:375,height:812};
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
