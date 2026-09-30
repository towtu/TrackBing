/** Shared wire contracts. These are data only; the server validates every input. */
export type PortionUnit =
  | "g"
  | "oz"
  | "ml"
  | "cup"
  | "piece"
  | "bar"
  | "serving"
  | "pack";
export type Portion = { amount: number; unit: PortionUnit };
export type FoodQuery = {
  name: string;
  preparation: string | null;
  brand: string | null;
  variant: string | null;
  packageGrams: number | null;
  market: string | null;
  barcode?: string | null;
  portion: Portion | null;
};
export type Nutrients = {
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};
export type NutritionBasis = {
  grams: number | null;
  nutrients: Nutrients;
  unit: "g" | "ml" | "cup" | "piece" | "bar" | "serving" | "pack";
  count: number | null;
  milliliters: number | null;
};
export type NutritionEvidence = {
  url: string;
  title: string;
  identity: string;
  retrievedAt: string;
  excerpt: string;
  basis: NutritionBasis;
  sourceId?: string;
  attribution?: string;
  license?: string;
  record?: "independent" | "user_owned";
};
export type ReviewedFood = {
  name: string;
  query: FoodQuery;
  portion: Portion;
  grams: number | null;
  servingLabel: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source:
    | "web"
    | "usda"
    | "trackbing_gist"
    | "openfoodfacts"
    | "my_food"
    | "user_label"
    | "ai_estimate";
  evidence: NutritionEvidence;
};
export type PendingFood = {
  kind?: "food";
  id: string;
  thread_id: string;
  review_version: number;
  status: "pending" | "confirmed" | "cancelled" | "superseded" | "expired";
  local_date: string;
  time_zone: string;
  expires_at: string;
  food: ReviewedFood;
};
export type BeePose = "greeting" | "thinking" | "encouraging" | "celebrating" | "caution" | "resting" | "searching" | "success";
export type WeightDraft = {
  weightKg: number; originalAmount: number; unit: "kg" | "lb";
  measuredAt: string; localDate: string; timeZone: string; updatesCurrentWeight: boolean;
};
export type GoalValues = {
  calorie_target: number | null; protein_grams: number | null; carbs_grams: number | null; fat_grams: number | null;
  goal_mode: string | null; goal_rate: number | null; target_weight: number | null;
  maintenance_calories: number | null; calculation_method: string | null;
};
export type GoalDraft = { previous: GoalValues; next: GoalValues; profileRevision: number };
type PendingBase = Omit<PendingFood, "kind" | "food">;
export type PendingWeight = PendingBase & { kind: "weight"; weight: WeightDraft };
export type PendingGoal = PendingBase & { kind: "goal"; goal: GoalDraft };
export type PendingAction = PendingFood | PendingWeight | PendingGoal;
export type BeeInsight = { text: string; suggested_pose: BeePose; context_revision: string; expires_at: string };
export type BeeTier = "basic" | "plus" | "pro";
export type BeeEntitlement = { tier: BeeTier; capabilities: Record<string, boolean>; remaining: Record<string, number>; limits: Record<string, number>; reset_at: string | null };
export type MemoryKey =
  | "preferred_name"
  | "preferred_units"
  | "usual_product"
  | "usual_preparation";
export type BeeMemory = { key: MemoryKey; value: string; updated_at: string };
export type BeeMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
  draft?: PendingAction;
};
/** Transient display only: never persist, index, or use as a log payload. */
export type GroundedAnswer = {
  text: string;
  citations: {
    title: string;
    url: string;
    startIndex: number;
    endIndex: number;
  }[];
  searchSuggestionsHtml: string[];
  searchQueryCount: number;
};
export type BeeSnapshot = {
  thread: { id: string; version: number };
  messages: BeeMessage[];
  memories: BeeMemory[];
  profile: Record<string, string | number | null>;
  pending: PendingAction | null;
  saved_log_id?: string;
  saved_action?: { kind: "food" | "weight" | "goal"; id: string; pending_id?: string; local_date: string };
  suggested_pose?: BeePose;
  insight?: BeeInsight;
  entitlement?: BeeEntitlement;
  summary_warning?: boolean;
  liveAnswer?: GroundedAnswer;
};
export type BeeCommand =
  | { kind: "load"; threadId?: string }
  | { kind: "new_thread" }
  | { kind: "clear_chat" }
  | { kind: "message"; text: string; actionId?: string; reviewVersion?: number }
  | { kind: "food_assist"; text: string; actionId?: string; reviewVersion?: number }
  | { kind: "insight"; refresh?: boolean }
  | { kind: "confirm" | "cancel"; actionId: string; reviewVersion: number }
  | { kind: "memory_set"; key: MemoryKey; value: string }
  | { kind: "memory_delete"; key: MemoryKey }
  | { kind: "memory_clear" };
// Clearing preferences and clearing chat are separate, explicit operations.
export type BeeRequest = {
  requestId: string;
  threadId?: string;
  expectedVersion?: number;
  timeZone: string;
  command: BeeCommand;
};
export type BeeErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "busy"
  | "expired"
  | "stale_action"
  | "over_free_quota"
  | "over_pro_cap"
  | "rate_limited"
  | "provider_unavailable"
  | "search_unavailable"
  | "not_configured"
  | "save_failed"
  | "offline"
  | "upgrade_required" | "pro_required" | "monthly_request_limit" | "monthly_input_limit" | "monthly_output_limit" | "monthly_insight_limit" | "monthly_search_limit"
  | "age_required" | "age_restricted" | "paid_data_unavailable" | "stale_profile"
  | "error";
export type BeeResult = { ok: true; snapshot: BeeSnapshot } | {
  ok: false;
  error: BeeErrorCode;
};
