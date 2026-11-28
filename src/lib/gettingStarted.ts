const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function isNewTrackBingAccount(createdAt: string | undefined, now = Date.now()) {
  if (!createdAt) return false;
  const age = now - Date.parse(createdAt);
  return age >= 0 && age < ONE_WEEK_MS;
}

export type SpotlightFrame = { x: number; y: number; width: number; height: number };

export function clipSpotlight(frame: SpotlightFrame, width: number, height: number): SpotlightFrame | null {
  if (!Object.values(frame).every(Number.isFinite) || frame.width <= 0 || frame.height <= 0 ||
    frame.x >= width || frame.y >= height || frame.x + frame.width <= 0 || frame.y + frame.height <= 0) return null;
  const padding = 4;
  const x = Math.max(0, frame.x - padding);
  const y = Math.max(0, frame.y - padding);
  return {
    x,
    y,
    width: Math.min(width, frame.x + frame.width + padding) - x,
    height: Math.min(height, frame.y + frame.height + padding) - y,
  };
}
