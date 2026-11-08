import { useEffect, useState, type RefObject } from "react";
import { AccessibilityInfo, AppState, Platform, type View } from "react-native";

/** Pause decorative movement before preferences load, off screen, or in background. */
export function useBeeMotion(viewport: RefObject<View | null>) {
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(false);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    let mounted = true, changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted && !changed) setReduced(value);
    }).catch(() => console.warn("Motion accessibility setting is unavailable; Bee remains still."));
    const accessibility = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => { changed = true; setReduced(value); });
    const app = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    const updateVisibility = () => setForeground(!document.hidden);
    if (Platform.OS === "web") {
      updateVisibility();
      document.addEventListener("visibilitychange", updateVisibility);
    } else setForeground(AppState.currentState === null || AppState.currentState === "active");
    return () => {
      mounted = false; accessibility.remove(); app.remove();
      if (Platform.OS === "web") document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof IntersectionObserver === "undefined") return;
    const element = viewport.current as unknown as Element;
    if (!(element instanceof Element)) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  return { reduced, active: foreground && inView };
}
