const COMPACT_PHONE_MAX_WIDTH = 389;

export function isCompactPhoneLayout(width: number): boolean {
  return width <= COMPACT_PHONE_MAX_WIDTH;
}
