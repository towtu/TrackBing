import { validTimeZone } from "./beeDates.ts";
import type {
  BeeCommand,
  BeeRequest,
  FoodQuery,
  MemoryKey,
  Portion,
  PortionUnit,
} from "./beeTypes.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNITS: PortionUnit[] = [
  "g",
  "oz",
  "ml",
  "cup",
  "piece",
  "bar",
  "serving",
  "pack",
];
const KEYS: MemoryKey[] = [
  "preferred_name",
  "preferred_units",
  "usual_product",
  "usual_preparation",
];
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bad_request");
  }
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("bad_request");
  }
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" || !value.trim() || value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  ) throw new Error("bad_request");
  return value.trim();
}
function uuid(value: unknown): string {
  const id = text(value, 36);
  if (!UUID.test(id)) throw new Error("bad_request");
  return id;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("bad_request");
  }
  return value;
}
export function memoryKey(value: unknown): MemoryKey {
  if (!KEYS.includes(value as MemoryKey)) throw new Error("bad_request");
  return value as MemoryKey;
}
export function memoryValue(key: MemoryKey, value: unknown): string {
  const clean = text(value, key === "preferred_name" ? 60 : 120);
  if (key === "preferred_units" && clean !== "grams" && clean !== "ounces") {
    throw new Error("bad_request");
  }
  return clean;
}
export function parseRequest(value: unknown): BeeRequest {
  const raw = record(value);
  fields(raw, [
    "requestId",
    "threadId",
    "expectedVersion",
    "timeZone",
    "command",
  ]);
  if (!validTimeZone(raw.timeZone)) throw new Error("bad_request");
  const c = record(raw.command);
  let command: BeeCommand;
  switch (c.kind) {
    case "load":
      fields(c, ["kind", "threadId"]);
      command = {
        kind: "load",
        ...(c.threadId === undefined ? {} : { threadId: uuid(c.threadId) }),
      };
      break;
    case "new_thread":
    case "clear_chat":
    case "memory_clear":
      fields(c, ["kind"]);
      command = { kind: c.kind };
      break;
    case "message":
      fields(c, ["kind", "text", "actionId", "reviewVersion"]);
      command = {
        kind: "message",
        text: text(c.text, 1000),
        ...(c.actionId === undefined ? {} : {
          actionId: uuid(c.actionId),
          reviewVersion: version(c.reviewVersion),
        }),
      };
      break;
    case "confirm":
    case "cancel":
      fields(c, ["kind", "actionId", "reviewVersion"]);
      command = {
        kind: c.kind,
        actionId: uuid(c.actionId),
        reviewVersion: version(c.reviewVersion),
      };
      break;
    case "memory_set": {
      fields(c, ["kind", "key", "value"]);
      const key = memoryKey(c.key);
      command = { kind: "memory_set", key, value: memoryValue(key, c.value) };
      break;
    }
    case "memory_delete":
      fields(c, ["kind", "key"]);
      command = { kind: "memory_delete", key: memoryKey(c.key) };
      break;
    default:
      throw new Error("bad_request");
  }
  const threadId = raw.threadId === undefined ? undefined : uuid(raw.threadId);
  if (
    command.kind === "load" && command.threadId && threadId &&
    command.threadId !== threadId
  ) throw new Error("bad_request");
  if (
    !["load", "new_thread"].includes(command.kind) &&
    (threadId === undefined || raw.expectedVersion === undefined)
  ) throw new Error("bad_request");
  if (JSON.stringify(raw).length > 8192) throw new Error("bad_request");
  return {
    requestId: uuid(raw.requestId),
    threadId,
    expectedVersion: raw.expectedVersion === undefined
      ? undefined
      : version(raw.expectedVersion),
    timeZone: raw.timeZone,
    command,
  };
}

export function parsePortion(value: unknown): Portion {
  const p = record(value);
  fields(p, ["amount", "unit"]);
  if (
    typeof p.amount !== "number" || !Number.isFinite(p.amount) ||
    p.amount <= 0 || p.amount > 10000 || !UNITS.includes(p.unit as PortionUnit)
  ) throw new Error("bad_request");
  if (
    ["piece", "bar", "serving", "pack", "cup"].includes(p.unit as string) &&
    p.amount > 100
  ) throw new Error("bad_request");
  return { amount: p.amount, unit: p.unit as PortionUnit };
}
export function parseFoodQuery(value: unknown): FoodQuery {
  const q = record(value);
  fields(q, [
    "name",
    "preparation",
    "brand",
    "variant",
    "packageGrams",
    "market",
    "barcode",
    "portion",
  ]);
  const nullable = (v: unknown, max = 120) =>
    v === null || v === undefined ? null : text(v, max);
  if (
    q.packageGrams != null &&
    (typeof q.packageGrams !== "number" || !Number.isFinite(q.packageGrams) ||
      q.packageGrams <= 0 || q.packageGrams > 10000)
  ) throw new Error("bad_request");
  if (
    q.barcode != null &&
    (typeof q.barcode !== "string" || !/^\d{8,14}$/.test(q.barcode))
  ) throw new Error("bad_request");
  return {
    ...(q.barcode == null ? {} : { barcode: q.barcode as string }),
    name: text(q.name, 160),
    preparation: nullable(q.preparation),
    brand: nullable(q.brand),
    variant: nullable(q.variant),
    packageGrams: q.packageGrams == null ? null : q.packageGrams as number,
    market: nullable(q.market, 60),
    portion: q.portion == null ? null : parsePortion(q.portion),
  };
}
export type BeeIntent =
  | { kind: "nutrition"; query: FoodQuery }
  | { kind: "clarify"; question: string; query: FoodQuery | null }
  | { kind: "history"; daysAgo: number; repeat: boolean }
  | { kind: "multiple" | "chat" };
export function parseIntent(value: unknown): BeeIntent {
  const r = record(value);
  switch (r.kind) {
    case "nutrition":
      fields(r, ["kind", "query"]);
      return { kind: "nutrition", query: parseFoodQuery(r.query) };
    case "clarify": {
      fields(r, ["kind", "question", "query"]);
      const question = text(r.question, 220);
      if (
        !question.endsWith("?") ||
        /https?:|added|logged|saved|password|api.?key|token/i.test(question)
      ) throw new Error("bad_request");
      return {
        kind: "clarify",
        question,
        query: r.query == null ? null : parseFoodQuery(r.query),
      };
    }
    case "history":
      fields(r, ["kind", "daysAgo", "repeat"]);
      if (
        typeof r.daysAgo !== "number" || !Number.isInteger(r.daysAgo) ||
        r.daysAgo < 0 || r.daysAgo > 366 || typeof r.repeat !== "boolean"
      ) throw new Error("bad_request");
      return { kind: "history", daysAgo: r.daysAgo, repeat: r.repeat };
    case "multiple":
    case "chat":
      fields(r, ["kind"]);
      return { kind: r.kind };
    default:
      throw new Error("bad_request");
  }
}
export function decisionText(value: string): "confirm" | "cancel" | null {
  const clean = value.trim().replace(/[.!]+$/, "").toLowerCase();
  if (
    /^(no|nope|cancel|never mind|nevermind|don't add( it)?|do not add( it)?)$/
      .test(clean)
  ) return "cancel";
  if (
    /^(yes|yep|yeah|add( it)?|add to today|log it|save it|confirm|go ahead)$/
      .test(clean)
  ) return "confirm";
  return null;
}
export type MemoryChange = { kind: "set"; key: MemoryKey; value: string } | {
  kind: "delete";
  key: MemoryKey;
};
export function explicitMemory(value: string): MemoryChange | null {
  const clean = value.trim().replace(/[.!]+$/, "").replace(
    /^(actually,?\s+|remember (that )?)/i,
    "",
  );
  const units = clean.match(/^I prefer (grams|ounces|g|oz)$/i);
  if (units) {
    return {
      kind: "set",
      key: "preferred_units",
      value: /^(g|grams)$/i.test(units[1]) ? "grams" : "ounces",
    };
  }
  const name = clean.match(
    /^(?:my (?:preferred )?name is|call me) (.{1,60})$/i,
  );
  if (name) {
    return {
      kind: "set",
      key: "preferred_name",
      value: memoryValue("preferred_name", name[1]),
    };
  }
  const product = clean.match(/^my usual (?:product|variant) is (.{1,120})$/i);
  if (product) {
    return {
      kind: "set",
      key: "usual_product",
      value: memoryValue("usual_product", product[1]),
    };
  }
  const preparation = clean.match(
    /^I usually measure (.{1,100}) (cooked|raw)$/i,
  );
  if (preparation) {
    return {
      kind: "set",
      key: "usual_preparation",
      value: memoryValue(
        "usual_preparation",
        `${preparation[1]} ${preparation[2].toLowerCase()}`,
      ),
    };
  }
  const forget = clean.match(
    /^(?:forget|delete|remove) (?:my |the )?(preferred units|units|preferred name|name|usual product|usual variant|usual preparation)(?: preference)?$/i,
  );
  if (forget) {
    return {
      kind: "delete",
      key: /units/i.test(forget[1])
        ? "preferred_units"
        : /name/i.test(forget[1])
        ? "preferred_name"
        : /preparation/i.test(forget[1])
        ? "usual_preparation"
        : "usual_product",
    };
  }
  return null;
}
export function portionCorrection(value: string): Portion | null {
  const match = value.trim().match(
    /^(?:actually[, ]*|instead[, ]*)?(?:(?:make (?:it|that)|change (?:it|that) to|use)\s+)?(\d+(?:\.\d+)?)\s*(grams?|g|ounces?|oz|milliliters?|ml|cups?|pieces?|bars?|servings?|packs?)[.!]?$/i,
  );
  if (!match) return null;
  const unit = match[2].toLowerCase();
  const normalized: PortionUnit = /^(g|gram)/.test(unit)
    ? "g"
    : /^(oz|ounce)/.test(unit)
    ? "oz"
    : /^(ml|milliliter)/.test(unit)
    ? "ml"
    : unit.replace(/s$/, "") as PortionUnit;
  return parsePortion({ amount: Number(match[1]), unit: normalized });
}

/** Fail closed when an interpreter drops a separately named item from a list. */
export function retainFoodList(intent: BeeIntent, message: string): BeeIntent {
  if (intent.kind !== "nutrition") return intent;
  // Strip only the nutrition question prefix: prepositions within a food list
  // ("egg and a slice of toast") must not hide an omitted item.
  const metric = "(?:calories?|kcal|nutrition|macros?|protein|carbs?|carbohydrates?|fat)";
  const prefix = new RegExp(
    `^(?:(?:how (?:many|much)|what(?:'s| is| are)?|show(?: me)?|tell me|can you (?:tell|show) me)\\s+)?(?:the\\s+)?${metric}(?:\\s*(?:and|plus|,|&|\\+)\\s*${metric})*\\s*(?:(?:count|content|values|is|are|there)\\s+)*(?:in|for|of)\\s+`,
    "i",
  );
  const foodText = message.replace(/^(?:actually|instead),?\s*/i, "").replace(prefix, "");
  const joined = /\b(?:and|plus)\b|\+/i;
  if (joined.test(foodText) && !joined.test(intent.query.name)) return { kind: "multiple" };
  return intent;
}
