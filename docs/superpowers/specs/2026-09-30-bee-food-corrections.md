# Bee food corrections and source priority

The user authorized autonomous implementation of these changes. Keep the current
Expo/Supabase stack, Bee art, palette, confirmation and owner boundaries.

Show a chat mascot only beside the latest assistant reply, including a transient
Search reply; keep the header mascot. Spell out Protein, Carbohydrates and Fat
with grams, including older compact assistant nutrition text.

Retain the current structured food and portion when a short preparation correction
arrives. An incomplete `ra` asks whether the user meant raw; Yes resolves that
clarification into a new lookup/review, never a diary write. Without food context,
ask which food. Exact `raw` updates preparation without changing chicken to a
drink. Missing chicken preparation must be clarified before fetching nutrition.

Use the existing fixed towtu gist first, then exact owned/barcode records where
available, Google Search on a miss, and USDA last. A USDA fallback uses the original
user query, never extracted Google text/links. Google results stay transient,
attributed and answer-only; only a separate independent record can create a review.
Preserve manual food/barcode paths and existing shared quotas.

The gist's existing c/p/cb/f contract is per 100 g for mass records. Missing values
remain unknown. Legacy volume or serving records without an explicit nutrition
basis must not be assigned a guessed density or serving basis. Label gist results
as operator-curated, retain source URL/snapshot, and never call them USDA verified.
Add a forward-only source-policy migration without widening client RPC grants.

The live public bundle was inspected read-only: it contains the old `ai-food`
client and “Does this look right?” copy, and no `bee-chat` caller. Main's old
backend uses DeepSeek V4 Flash and Tavily/V4 Pro for web mode. Provider deployment
settings cannot be proven by public frontend code. Do not deploy or merge.
