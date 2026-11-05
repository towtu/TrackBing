import { supabase } from "./supabase";
import {
  type LabelExtraction,
  parseLabelExtraction,
  validateLabelImage,
} from "../../supabase/functions/_shared/nutritionLabel";
import type { BeeErrorCode } from "./beeChat";
export type LabelReadResult = { ok: true; label: LabelExtraction } | {
  ok: false;
  error: BeeErrorCode;
};
export function createLabelReader(userId: string) {
  let active = true;
  const controllers = new Set<AbortController>();
  return {
    async read(
      requestId: string,
      image: string,
    ): Promise<LabelReadResult | null> {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        validateLabelImage(image);
        const { data: { session } } = await supabase.auth.getSession();
        if (!active || session?.user.id !== userId) return null;
        const { data, error } = await supabase.functions.invoke("ai-label", {
          body: { requestId, image },
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
          timeout: 45000,
        });
        let value: unknown = data;
        if (
          !data && error && "context" in error &&
          error.context instanceof Response
        ) {
          try {
            value = await error.context.json();
          } catch {
            value = null;
          }
        }
        const current = await supabase.auth.getSession();
        if (!active || current.data.session?.user.id !== userId) return null;
        if (value && typeof value === "object" && "ok" in value) {
          if (value.ok === true && "label" in value) {
            try {
              return { ok: true, label: parseLabelExtraction(value.label) };
            } catch {
              return { ok: false, error: "error" };
            }
          }
          if (
            "error" in value && typeof value.error === "string" &&
            [
              "upgrade_required",
              "age_required",
              "age_restricted",
              "paid_data_unavailable",
              "not_configured",
              "monthly_request_limit",
              "monthly_input_limit",
              "monthly_output_limit",
              "rate_limited",
              "busy",
              "conflict",
              "unauthorized",
              "bad_request",
              "provider_unavailable",
            ].includes(value.error)
          ) return { ok: false, error: value.error as BeeErrorCode };
        }
        // SDK transport errors may resolve instead of throwing. Their result
        // is uncertain: retain the request key to recover a lost success.
        return { ok: false, error: error ? "offline" : "error" };
      } catch {
        return active ? { ok: false, error: "offline" } : null;
      } finally {
        controllers.delete(controller);
      }
    },
    dispose() {
      active = false;
      controllers.forEach((c) => c.abort());
      controllers.clear();
    },
  };
}
