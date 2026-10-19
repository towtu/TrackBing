import CircularProgress from "react-native-circular-progress-indicator";
import { Colors } from "@/src/styles/colors";

export type CalorieProgressProps = {
  calories: number;
  goal: number;
  over: boolean;
};

/** Keep the existing native progress renderer behind a platform boundary. */
export function CalorieProgress({ calories, goal, over }: CalorieProgressProps) {
  return (
    <CircularProgress
      value={calories}
      radius={65}
      maxValue={goal}
      showProgressValue={false}
      activeStrokeColor={over ? Colors.error : Colors.accent}
      activeStrokeWidth={9}
      inActiveStrokeColor={Colors.border}
      inActiveStrokeWidth={9}
      inActiveStrokeOpacity={1}
      title=""
    />
  );
}
