type FoodLogListener = () => void;

const listeners = new Set<FoodLogListener>();

export function subscribeFoodLogChanged(listener: FoodLogListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitFoodLogChanged() {
  listeners.forEach((listener) => listener());
}
