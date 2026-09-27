import type {
  FoodQuery,
  NutritionBasis,
  NutritionEvidence,
  ReviewedFood,
} from "./beeTypes.ts";
export type NutritionResult = { kind: "found"; food: ReviewedFood } | {
  kind: "clarification" | "unavailable";
  message: string;
};
export type PersonalRecord = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  default_unit: string;
  ai_estimated?: boolean;
};
export type NutritionDependencies = {
  usdaApiKey: string;
  signal: AbortSignal;
  fetch?: typeof fetch;
  now?: () => Date;
  personal: (query: FoodQuery) => Promise<PersonalRecord[]>;
};
const INJECTION =
  /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|system)\s+instructions|\b(?:system|assistant|developer)\s*:|\b(?:reveal|send|exfiltrate)\b[^\n]{0,80}\b(?:api\s*keys?|secrets?|tokens?)\b|<\/?(?:system|tool_call|assistant)>/i;
const unavailable = (): NutritionResult => ({
  kind: "unavailable",
  message:
    "I couldn't verify a matching nutrition label with calories, protein, carbs and fat. Add the label manually or try a more specific food.",
});
const clarify = (message: string): NutritionResult => ({
  kind: "clarification",
  message,
});
const round = (value: number) => Math.round(value * 10) / 10;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function normalize(text: string): string {
  const singular: Record<string, string> = {
    eggs: "egg",
    whites: "white",
    yolks: "yolk",
    bars: "bar",
    pieces: "piece",
    philippines: "philippines",
    ph: "philippines",
    usa: "united states",
  };
  return text.toLowerCase().normalize("NFKC").replace(
    /hard[\s-]*(?:boiled|cooked)/g,
    "boiled",
  )
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).map((word) =>
      singular[word] ?? word
    ).join(" ");
}

function containsWords(text: string, requested: string): boolean {
  const actual = new Set(normalize(text).split(" "));
  return normalize(requested).split(" ").filter(Boolean).every((word) =>
    actual.has(word)
  );
}

function preflight(query: FoodQuery): NutritionResult | null {
  if (
    typeof query.name !== "string" || !query.name.trim() ||
    query.name.length > 160 || INJECTION.test(query.name)
  ) return unavailable();
  if (
    [query.preparation, query.brand, query.variant, query.market].some((
      value,
    ) => value !== null && (typeof value !== "string" || value.length > 120))
  ) return unavailable();
  if (
    query.packageGrams !== null &&
    (!positive(query.packageGrams) || query.packageGrams > 50_000)
  ) return unavailable();
  if (
    !query.barcode && /fudgee/i.test(`${query.name} ${query.brand ?? ""}`) &&
    (!query.variant?.trim() || !query.packageGrams)
  ) {
    return clarify(
      "Which Fudgee Barr flavor and package size in grams did you have?",
    );
  }
  if (
    !query.portion || !positive(query.portion.amount) ||
    query.portion.amount > 50_000
  ) {
    return clarify(
      "How much did you have? Give the weight in grams or a labeled serving amount.",
    );
  }
  return null;
}

/** Only retained structured records from an independent API or owned food are loggable. */
export function scaleEvidence(
  query: FoodQuery,
  evidence: NutritionEvidence,
  source: ReviewedFood["source"],
): NutritionResult {
  const early = preflight(query);
  if (early) return early;
  if (!evidence.record) return unavailable();
  return scaleRecord(query, evidence, source);
}

/** Conservative identity matching: source text never becomes instructions. */
export function identityMatches(query: FoodQuery, identity: string): boolean {
  if (INJECTION.test(identity) || !containsWords(identity, query.name)) {
    return false;
  }
  const actual = normalize(identity),
    wanted = normalize(
      [query.name, query.preparation, query.brand, query.variant].filter(
        Boolean,
      ).join(" "),
    );
  for (const detail of [query.preparation, query.brand, query.variant]) {
    if (detail && !containsWords(identity, detail)) return false;
  }
  if (/\begg\b/.test(wanted)) {
    for (const part of ["white", "yolk"]) {
      if (
        new RegExp(`\\b${part}\\b`).test(actual) !==
          new RegExp(`\\b${part}\\b`).test(wanted)
      ) return false;
    }
  }
  for (
    const word of actual.match(
      /\b(raw|uncooked|fried|scrambled|roasted|baked|boiled|steamed|dry|dried)\b/g,
    ) ?? []
  ) if (!wanted.split(" ").includes(word)) return false;
  for (
    const word of actual.match(
      /\b(chocolate|vanilla|mocha|ube|yema|custard|banana|strawberry|dark|white|milk|unsweetened|sweetened|skim|low|free)\b/g,
    ) ?? []
  ) if (!wanted.split(" ").includes(word)) return false;
  return true;
}

function compatiblePackage(
  query: FoodQuery,
  basis: NutritionBasis,
  packageGrams: unknown,
): boolean {
  if (query.packageGrams === null || query.packageGrams === packageGrams) {
    return true;
  }
  // A matching single labeled bar/piece may be sold in a larger multipack.
  // This exception never turns one pack into one bar or invents a piece weight.
  return query.portion?.unit === basis.unit &&
    ["bar", "piece", "serving"].includes(basis.unit) &&
    positive(basis.grams) && positive(basis.count) &&
    basis.grams / basis.count === query.packageGrams;
}
function scaleRecord(
  query: FoodQuery,
  evidence: NutritionEvidence,
  source: ReviewedFood["source"],
): NutritionResult {
  if (
    !["usda", "openfoodfacts", "my_food", "user_label"].includes(source) ||
    !identityMatches(query, evidence.identity)
  ) return unavailable();
  if (evidence.excerpt.length > 12000 || INJECTION.test(evidence.excerpt)) {
    return unavailable();
  }
  let snapshot: Record<string, unknown>;
  try {
    snapshot = JSON.parse(evidence.excerpt);
  } catch {
    return unavailable();
  }
  if (
    snapshot.identity !== evidence.identity || snapshot.url !== evidence.url ||
    snapshot.sourceId !== evidence.sourceId ||
    JSON.stringify(snapshot.basis) !== JSON.stringify(evidence.basis)
  ) return unavailable();
  if (
    source === "usda" &&
    evidence.url !==
      `https://fdc.nal.usda.gov/food-details/${evidence.sourceId}/nutrients`
  ) return unavailable();
  if (
    source === "openfoodfacts" &&
    evidence.url !==
      `https://world.openfoodfacts.org/product/${evidence.sourceId}`
  ) return unavailable();
  if (
    source === "my_food" &&
    (evidence.record !== "user_owned" || evidence.url !== "")
  ) return unavailable();
  if (!compatiblePackage(query, evidence.basis, snapshot.packageGrams)) {
    return unavailable();
  }
  const basis = evidence.basis, n = basis.nutrients;
  if (
    Object.values(n).some((v) =>
      typeof v !== "number" || !Number.isFinite(v) || v < 0
    ) || !positive(basis.grams) && basis.grams !== null
  ) return unavailable();
  if (
    basis.grams !== null &&
    (n.calories > basis.grams * 10 + 20 ||
      n.protein! + n.carbs! + n.fat! > basis.grams * 1.2)
  ) return unavailable();
  const portion = query.portion!;
  let grams: number | null = null, factor: number | null = null;
  if (portion.unit === "g" || portion.unit === "oz") {
    grams = portion.amount * (portion.unit === "oz" ? 28.349523125 : 1);
    if (positive(basis.grams)) factor = grams / basis.grams;
  } else if (portion.unit === "ml" && positive(basis.milliliters)) {
    factor = portion.amount / basis.milliliters;
    grams = positive(basis.grams) ? basis.grams * factor : null;
  } else if (portion.unit === basis.unit && positive(basis.count)) {
    factor = portion.amount / basis.count;
    grams = positive(basis.grams) ? basis.grams * factor : null;
  } else if (
    portion.unit === "pack" && positive(snapshot.packageGrams) &&
    positive(basis.grams)
  ) {
    grams = portion.amount * snapshot.packageGrams;
    factor = grams / basis.grams;
  }
  if (!positive(factor)) {
    return clarify(
      "I need a weight in grams or a label giving the weight of that bar, serving or volume. What does the package say?",
    );
  }
  if (
    (grams !== null && (!positive(grams) || grams > 10000)) ||
    n.calories * factor > 10000
  ) {
    return clarify(
      "That portion is unusually large. What amount and unit did you mean?",
    );
  }
  const servingLabel = `${portion.amount} ${portion.unit}${
    portion.amount !== 1 && !["g", "oz", "ml"].includes(portion.unit) ? "s" : ""
  }${
    grams !== null && !["g", "oz"].includes(portion.unit)
      ? ` (${round(grams)} g)`
      : ""
  }`;
  return {
    kind: "found",
    food: {
      name: evidence.identity,
      query,
      portion,
      grams,
      servingLabel,
      source,
      evidence,
      calories: Math.round(n.calories * factor),
      protein: round(n.protein! * factor),
      carbs: round(n.carbs! * factor),
      fat: round(n.fat! * factor),
    },
  };
}

/** Fixed independent API destinations only; redirects are rejected, not followed. */
async function apiJson(
  url: string,
  init: RequestInit,
  deps: NutritionDependencies,
): Promise<unknown> {
  const signal = AbortSignal.any([deps.signal, AbortSignal.timeout(8000)]);
  const operation = (async () => {
    const response = await (deps.fetch ?? fetch)(url, {
      ...init,
      redirect: "error",
      signal,
    });
    if (
      !response.ok || Number(response.headers.get("content-length")) > 160000 ||
      !response.body
    ) throw new Error("nutrition_unavailable");
    const reader = response.body.getReader();
    let total = 0, body = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 160000) {
          await reader.cancel();
          throw new Error("nutrition_unavailable");
        }
        body += decoder.decode(value, { stream: true });
      }
      return JSON.parse(body + decoder.decode());
    } finally {
      reader.releaseLock();
    }
  })();
  return await new Promise((resolve, reject) => {
    const abort = () => reject(new Error("nutrition_unavailable"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort)
    );
  });
}
function nutrient(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
function evidence(
  identity: string,
  basis: NutritionBasis,
  sourceId: string,
  url: string,
  packageGrams: number | null,
  data: unknown,
  source: ReviewedFood["source"],
  now: string,
): NutritionEvidence {
  const attribution = source === "usda"
    ? "USDA FoodData Central (CC0)"
    : source === "openfoodfacts"
    ? "Open Food Facts contributors (ODbL)"
    : "Your saved food";
  return {
    identity,
    title: identity,
    basis,
    sourceId,
    url,
    retrievedAt: now,
    record: source === "my_food" ? "user_owned" : "independent",
    attribution,
    license: source === "usda"
      ? "CC0-1.0"
      : source === "openfoodfacts"
      ? "ODbL-1.0"
      : "user-owned",
    excerpt: JSON.stringify({
      identity,
      basis,
      sourceId,
      url,
      packageGrams,
      data,
    }),
  };
}
function select(
  query: FoodQuery,
  entries: NutritionEvidence[],
  source: ReviewedFood["source"],
): NutritionResult | null {
  const matched = entries.filter((e) => identityMatches(query, e.identity));
  if (!matched.length) return null;
  if (matched.length > 1) {
    const first = matched[0].basis;
    if (
      matched.slice(1).some((e) =>
        Object.keys(first.nutrients).some((key) => {
          const k = key as keyof typeof first.nutrients,
            a = first.nutrients[k],
            b = e.basis.nutrients[k];
          if (
            a === null || b === null || !first.grams || !e.basis.grams
          ) return a !== b;
          return Math.abs(a / first.grams - b / e.basis.grams) >
            Math.max(.005, Math.max(a / first.grams, b / e.basis.grams) * .05);
        })
      )
    ) {
      return clarify(
        "I found differing nutrition records for this food. Which exact product or package label should I use?",
      );
    }
  }
  const result = scaleEvidence(query, matched[0], source);
  return result.kind === "unavailable"
    ? {
      kind: "clarification",
      message:
        "The matching record is missing calories or a macro. Please enter the complete package label in Add Food, or provide another exact product.",
    }
    : result;
}

/** No Google data or model-generated nutrition can enter this resolver. */
export async function searchNutrition(
  query: FoodQuery,
  deps: NutritionDependencies,
): Promise<NutritionResult> {
  const early = preflight(query);
  if (early) return early;
  const now = (deps.now?.() ?? new Date()).toISOString();
  const personal = await deps.personal(query);
  const own = personal.filter((p) =>
    !p.ai_estimated && identityMatches(query, p.name)
  ).map((p) => {
    const unit =
      (["g", "ml", "cup", "piece", "bar", "serving", "pack"].includes(
          p.default_unit,
        )
        ? p.default_unit
        : null) as NutritionBasis["unit"] | null;
    if (!unit) return null;
    const basis: NutritionBasis = {
      grams: unit === "g" ? 100 : null,
      unit,
      count: unit === "g" || unit === "ml" ? null : 1,
      milliliters: unit === "ml" ? 100 : null,
      nutrients: {
        calories: p.calories,
        protein: p.protein,
        carbs: p.carbs,
        fat: p.fat,
      },
    };
    return evidence(p.name, basis, p.id, "", null, { ...p }, "my_food", now);
  }).filter((e): e is NutritionEvidence => e !== null);
  const ownResult = select(query, own, "my_food");
  if (ownResult) return ownResult;
  // USDA generic records are never used to replace a branded product.
  if (
    !query.brand && !query.variant && !/fudgee/i.test(query.name) &&
    deps.usdaApiKey
  ) {
    let data: unknown;
    try {
      data = await apiJson(
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${
          encodeURIComponent(deps.usdaApiKey)
        }`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: [query.name, query.preparation].filter(Boolean).join(" "),
            dataType: ["SR Legacy", "Foundation", "Survey (FNDDS)"],
            pageSize: 8,
          }),
        },
        deps,
      );
    } catch {
      data = null;
    }
    const raw = object(data)?.foods;
    const records = (Array.isArray(raw) ? raw : []).slice(0, 8).flatMap(
      (value): NutritionEvidence[] => {
        const food = object(value);
        if (
          !food || typeof food.description !== "string" ||
          !Number.isSafeInteger(food.fdcId) ||
          !identityMatches(query, food.description)
        ) return [];
        const ns = Array.isArray(food.foodNutrients)
          ? food.foodNutrients.map(object).filter((
            n,
          ): n is Record<string, unknown> => n !== null)
          : [];
        const get = (id: number) =>
          nutrient(ns.find((n) => n.nutrientId === id)?.value);
        const calories = get(1008) ??
          (get(1062) === null ? null : get(1062)! / 4.184);
        if (calories === null) return [];
        const basis: NutritionBasis = {
          grams: 100,
          unit: "g",
          count: null,
          milliliters: null,
          nutrients: {
            calories,
            protein: get(1003),
            carbs: get(1005),
            fat: get(1004),
          },
        };
        const id = String(food.fdcId);
        return [
          evidence(
            food.description,
            basis,
            id,
            `https://fdc.nal.usda.gov/food-details/${id}/nutrients`,
            null,
            {
              fdcId: food.fdcId,
              description: food.description,
              foodNutrients: ns.filter((n) =>
                [1008, 1062, 1003, 1005, 1004].includes(Number(n.nutrientId))
              ),
            },
            "usda",
            now,
          ),
        ];
      },
    );
    const result = select(query, records, "usda");
    if (result) return result;
  }
  const fields =
    "code,product_name,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutriments,countries_tags,nutrition_data_per";
  const term = [query.name, query.brand, query.variant].filter(Boolean).join(
    " ",
  );
  const url = query.barcode
    ? `https://world.openfoodfacts.org/api/v3/product/${
      encodeURIComponent(query.barcode)
    }?fields=${fields}`
    : `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${
      encodeURIComponent(term)
    }&search_simple=1&action=process&json=1&page_size=5&lc=en&fields=${fields}`;
  let data: unknown;
  try {
    data = await apiJson(url, {
      headers: {
        "User-Agent": "TrackBing/1.0 (https://github.com/towtu/TrackBing)",
      },
    }, deps);
  } catch {
    return unavailable();
  }
  const raw = object(data),
    products = query.barcode
      ? [raw?.product]
      : Array.isArray(raw?.products)
      ? raw.products
      : [];
  if (
    !query.barcode && products.some((value) => {
      const p = object(value);
      return p && typeof p.product_name === "string" &&
        containsWords(p.product_name, query.name) &&
        ((typeof p.brands === "string" && p.brands.trim() &&
          query.packageGrams === null &&
          ["bar", "piece", "serving", "pack"].includes(query.portion!.unit)) ||
          !identityMatches({ ...query, brand: null }, p.product_name));
    })
  ) {
    return clarify(
      "Which product flavor and package size in grams did you mean?",
    );
  }
  const entries = products.slice(0, 5).flatMap((value): NutritionEvidence[] => {
    const p = object(value);
    if (
      !p || typeof p.product_name !== "string" || typeof p.code !== "string" ||
      !/^\d{8,14}$/.test(p.code)
    ) return [];
    const identity = [p.product_name, p.brands].filter((v) =>
      typeof v === "string"
    ).join(" ");
    if (!identityMatches(query, identity)) return [];
    const markets = Array.isArray(p.countries_tags)
      ? p.countries_tags.join(" ")
      : "";
    if (query.market && !containsWords(markets, query.market)) return [];
    const packageGrams = p.product_quantity_unit === "g"
      ? nutrient(p.product_quantity)
      : null;

    const n = object(p.nutriments);
    if (!n) return [];
    // OFF _100g fields can describe 100 ml for liquids: require an explicit g unit.
    if (p.product_quantity_unit !== "g" && p.serving_quantity_unit !== "g") {
      return [];
    }
    const kcal = nutrient(n["energy-kcal_100g"]) ??
      (nutrient(n["energy-kj_100g"]) === null
        ? null
        : nutrient(n["energy-kj_100g"])! / 4.184);
    if (kcal === null) return [];
    let basis: NutritionBasis = {
      grams: 100,
      unit: "g",
      count: null,
      milliliters: null,
      nutrients: {
        calories: kcal,
        protein: nutrient(n.proteins_100g),
        carbs: nutrient(n.carbohydrates_100g),
        fat: nutrient(n.fat_100g),
      },
    };
    const label = typeof p.serving_size === "string" ? p.serving_size : "";
    const serving = label.match(
      /^(\d+(?:\.\d+)?)\s*(bars?|pieces?|servings?|packs?)\s*\(\s*(\d+(?:\.\d+)?)\s*g\s*\)$/i,
    );
    if (
      serving && Number(serving[3]) === p.serving_quantity &&
      p.serving_quantity_unit === "g"
    ) {
      const grams = Number(serving[3]), factor = grams / 100;
      basis = {
        ...basis,
        grams,
        unit: serving[2].toLowerCase().replace(
          /s$/,
          "",
        ) as NutritionBasis["unit"],
        count: Number(serving[1]),
        nutrients: {
          calories: kcal * factor,
          protein: basis.nutrients.protein === null
            ? null
            : basis.nutrients.protein * factor,
          carbs: basis.nutrients.carbs === null
            ? null
            : basis.nutrients.carbs * factor,
          fat: basis.nutrients.fat === null
            ? null
            : basis.nutrients.fat * factor,
        },
      };
    }
    if (!compatiblePackage(query, basis, packageGrams)) return [];
    return [
      evidence(
        identity,
        basis,
        p.code,
        `https://world.openfoodfacts.org/product/${p.code}`,
        packageGrams,
        {
          code: p.code,
          product_name: p.product_name,
          brands: p.brands,
          quantity: p.quantity,
          serving_size: p.serving_size,
          serving_quantity: p.serving_quantity,
          nutriments: Object.fromEntries(
            Object.entries(n).filter(([key]) =>
              [
                "energy-kcal_100g",
                "energy-kj_100g",
                "proteins_100g",
                "carbohydrates_100g",
                "fat_100g",
              ].includes(key)
            ),
          ),
        },
        "openfoodfacts",
        now,
      ),
    ];
  });
  return select(query, entries, "openfoodfacts") ?? unavailable();
}
