import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedJsonFetch, geminiGrounded, geminiJson } from "./beeProviders.ts";
import { isSafeGroundingUrl, validateSuggestionsHtml } from "./beeGrounding.ts";
import type { FoodQuery } from "./beeTypes.ts";

const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
const options = () => ({ signal: new AbortController().signal, apiKey: "test-key" });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const output = (text: string, annotations?: unknown[]) => ({ type: "model_output", content: [{ type: "text", text, ...(annotations ? { annotations } : {}) }] });
const completed = (text = '{"kind":"chat"}') => ({ status: "completed", steps: [output(text)], usage: { total_input_tokens: 18, total_output_tokens: 7 } });
const query: FoodQuery = { name: "Fudgee Barr", brand: "Rebisco", variant: "chocolate", preparation: null, packageGrams: 38, market: "Philippines", portion: { amount: 1, unit: "bar" } };
const suggestions = '<style>.container{display:flex;gap:8px}@media (prefers-color-scheme:dark){.container{color:#fff}}</style><div class="container"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M1 1L2 2" fill="#4285f4" /></svg><a href="https://www.google.com/search?q=Fudgee+Barr&amp;hl=en" target="_blank">Fudgee Barr</a></div>';
const grounded = (text = "The exact nutrition panel is unverified.") => ({
  status: "completed", steps: [
    { type: "thought", summary: [{ type: "text", text: "PRIVATE THOUGHT" }] },
    { type: "google_search_call", id: "search-1", arguments: { queries: ["Fudgee Barr chocolate 38g", "Rebisco nutrition panel"] } },
    { type: "google_search_result", call_id: "search-1", result: [{ search_suggestions: suggestions }] },
    output(text, [{ type: "url_citation", url: "https://www.rebisco.com.ph/products", title: "Rebisco", start_index: 0, end_index: new TextEncoder().encode(text).length }]),
  ], usage: { total_input_tokens: 42, total_output_tokens: 19 },
});
afterEach(() => vi.useRealTimers());

describe("Bee provider boundaries", () => {
  it("posts JSON to Google's fixed endpoint and refuses redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ready: true }));
    await expect(boundedJsonFetch(endpoint, { hello: "world" }, { ...options(), fetch: fetcher })).resolves.toEqual({ ready: true });
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", redirect: "error", body: '{"hello":"world"}' }));
  });
  it.each(["http://127.0.0.1/secret", "https://api.deepseek.com/chat/completions", "https://api.tavily.com/search", `${endpoint}/other`])("rejects arbitrary and legacy endpoints %s", async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(boundedJsonFetch(url as typeof endpoint, {}, { ...options(), fetch: fetcher })).rejects.toThrow("unsupported_endpoint");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects oversized streamed bodies without Content-Length", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.close(); } })));
    await expect(boundedJsonFetch(endpoint, {}, { ...options(), fetch: fetcher, maxBytes: 50 })).rejects.toThrow("response_too_large");
  });
  it("caps requested response limits at 256KB", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(256_001)));
    await expect(boundedJsonFetch(endpoint, {}, { ...options(), fetch: fetcher, maxBytes: 999_999 })).rejects.toThrow("response_too_large");
  });
  it("caps serialized request bytes before HTTP", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(boundedJsonFetch(endpoint, { content: "é".repeat(50_000) }, { ...options(), fetch: fetcher })).rejects.toThrow("context_too_large");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not expose provider error bodies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("SECRET DETAIL", { status: 429 }));
    await expect(boundedJsonFetch(endpoint, {}, { ...options(), fetch: fetcher })).rejects.toThrow(/^http_error$/);
  });
  it("rejects malformed provider JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Oops</html>"));
    await expect(boundedJsonFetch(endpoint, {}, { ...options(), fetch: fetcher })).rejects.toThrow("invalid_response");
  });
  it("times out after 25 seconds even if fetch ignores abort", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const result = boundedJsonFetch(endpoint, {}, { ...options(), fetch: fetcher });
    await Promise.all([expect(result).rejects.toThrow("timeout"), vi.advanceTimersByTimeAsync(25_000)]);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("refuses requests already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(boundedJsonFetch(endpoint, {}, { signal: controller.signal, fetch: fetcher })).rejects.toThrow("aborted");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels an in-flight request on parent abort", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const result = boundedJsonFetch(endpoint, {}, { signal: controller.signal, fetch: fetcher });
    const rejected = expect(result).rejects.toThrow("aborted"); controller.abort(); await rejected;
  });
  it("keeps its timeout active while streaming", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream()));
    const result = boundedJsonFetch(endpoint, {}, { ...options(), fetch: fetcher, timeoutMs: 100 });
    await Promise.all([expect(result).rejects.toThrow("timeout"), vi.advanceTimersByTimeAsync(100)]);
  });
});

describe("Gemini JSON interpretation", () => {
  it("uses stateless Flash Lite, minimal hidden thinking, JSON format and no Search", async () => {
    const onUsage = vi.fn(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed()));
    await expect(geminiJson("Return JSON", { text: "hi" }, { ...options(), fetch: fetcher, maxTokens: 9999, onUsage })).resolves.toEqual({ kind: "chat" });
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ model: "gemini-3.5-flash-lite", input: '{"text":"hi"}', system_instruction: "Return JSON", store: false, stream: false, response_format: { type: "text", mime_type: "application/json" }, generation_config: { thinking_level: "minimal", thinking_summaries: "none", max_output_tokens: 900 } });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 18, outputTokens: 7, searchQueries: 0 });
  });
  it("accepts a validated configured Flash model", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed()));
    await geminiJson("Return JSON", {}, { ...options(), model: "gemini-3.1-flash-lite", fetch: fetcher, maxTokens: 100 });
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({ model: "gemini-3.1-flash-lite", generation_config: { max_output_tokens: 100 } });
  });
  it.each(["", "models/gemini-3.5-flash-lite", "https://internal/model", "deepseek-chat", "gemini-3.5-flash-image"])("rejects invalid model %s before HTTP", async (model) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(geminiJson("Return JSON", {}, { ...options(), model, fetch: fetcher })).rejects.toThrow("not_configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([completed(""), completed("bad JSON"), completed("[]"), completed("null"), { status: "incomplete", steps: [output("{}")] }, { status: "requires_action", steps: [output("{}")] }, { status: "completed", steps: [] }])("rejects malformed or noncompleted JSON", async (payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    await expect(geminiJson("Return JSON", {}, { ...options(), fetch: fetcher })).rejects.toThrow("invalid_response");
  });
  it.each(["function_call", "google_search_call", "url_context_call", "mcp_server_tool_call"])("rejects illicit interpretation tool %s", async (type) => {
    const payload = { ...completed(), steps: [...completed().steps, { type, arguments: { queries: ["secret"] } }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    await expect(geminiJson("Return JSON", {}, { ...options(), fetch: fetcher })).rejects.toThrow("invalid_response");
  });
});

describe("Gemini live grounding", () => {
  it("preserves provider answer/widget and returns metadata citations plus numeric usage only", async () => {
    const onUsage = vi.fn(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(grounded()));
    const answer = await geminiGrounded(query, { ...options(), fetch: fetcher, maxTokens: 9999, onUsage });
    expect(answer).toEqual({ text: "The exact nutrition panel is unverified.", citations: [{ title: "Rebisco", url: "https://www.rebisco.com.ph/products", startIndex: 0, endIndex: 40 }], searchSuggestionsHtml: [suggestions], searchQueryCount: 2 });
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ model: "gemini-3.5-flash-lite", store: false, stream: false, tools: [{ type: "google_search" }], generation_config: { thinking_level: "minimal", thinking_summaries: "none", max_output_tokens: 1600 } });
    expect(body).not.toHaveProperty("response_format"); expect(body).not.toHaveProperty("previous_interaction_id");
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 42, outputTokens: 19, searchQueries: 2 });
  });
  it("allowlists food identity fields rather than sending unexpected private fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(grounded()));
    await geminiGrounded({ ...query, profile: "PRIVATE PROFILE", diary: "PRIVATE DIARY" } as FoodQuery, { ...options(), fetch: fetcher });
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body.input).toContain("Fudgee Barr"); expect(body.input).not.toMatch(/PRIVATE|profile|diary/);
    expect(body.system_instruction).toMatch(/unverified|verify/i); expect(body.system_instruction).toMatch(/nutrition panel/i);
  });
  it("converts UTF8 byte citation offsets across text blocks for client slicing", async () => {
    const payload = grounded("Café 🥚");
    payload.steps[payload.steps.length - 1] = output("Café 🥚", [{ type: "url_citation", url: "https://example.com/panel", title: "Panel", start_index: 6, end_index: 10 }]);
    payload.steps.push(output(" done.", [{ type: "url_citation", url: "https://example.com/other", title: "Other", start_index: 1, end_index: 5 }]));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    const answer = await geminiGrounded(query, { ...options(), fetch: fetcher });
    expect(answer.text).toBe("Café 🥚 done."); expect(answer.citations.map(c => [c.startIndex, c.endIndex])).toEqual([[5, 7], [8, 12]]);
  });
  it("never treats plain-text URLs as source citation metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(grounded("See https://invented.example/nutrition")));
    const answer = await geminiGrounded(query, { ...options(), fetch: fetcher });
    expect(answer.citations.map(c => c.url)).toEqual(["https://www.rebisco.com.ph/products"]);
  });
  it.each(["text", "citations", "widgets"])("rejects grounded %s exceeding the client display limit", async (limit) => {
    const payload: Record<string, unknown> = grounded(limit === "text" ? "x".repeat(20_001) : "Valid answer.");
    const steps = payload.steps as Record<string, unknown>[];
    if (limit === "citations") (steps[3].content as Record<string, unknown>[])[0].annotations = Array.from({ length: 101 }, () => ({ type: "url_citation", title: "Source", url: "https://example.com/panel", start_index: 0, end_index: 2 }));
    if (limit === "widgets") steps[2].result = Array.from({ length: 6 }, () => ({ search_suggestions: suggestions }));
    const onUsage = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    await expect(geminiGrounded(query, { ...options(), fetch: fetcher, onUsage })).rejects.toThrow("invalid_response");
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 42, outputTokens: 19, searchQueries: 2 });
  });
  it("accepts grounding exactly at client display limits without truncation", async () => {
    const payload: Record<string, unknown> = grounded("x".repeat(20_000));
    const steps = payload.steps as Record<string, unknown>[];
    (steps[3].content as Record<string, unknown>[])[0].annotations = Array.from({ length: 100 }, () => ({ type: "url_citation", title: "Source", url: "https://example.com/panel", start_index: 0, end_index: 20_000 }));
    steps[2].result = Array.from({ length: 5 }, () => ({ search_suggestions: suggestions }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    const result = await geminiGrounded(query, { ...options(), fetch: fetcher });
    expect(result.text).toHaveLength(20_000); expect(result.citations).toHaveLength(100); expect(result.searchSuggestionsHtml).toHaveLength(5);
  });
  it.each(["missing citations", "missing suggestions", "missing queries", "failed search", "invalid citation bounds", "private citation", "unsafe widget", "custom tool", "noncompleted"])("rejects %s", async (scenario) => {
    const payload: Record<string, unknown> = grounded(); const steps = payload.steps as Record<string, unknown>[];
    const content = (steps[3].content as Record<string, unknown>[])[0];
    if (scenario === "missing citations") delete content.annotations;
    if (scenario === "missing suggestions") steps[2].result = [{}];
    if (scenario === "missing queries") steps[1].arguments = { queries: [] };
    if (scenario === "failed search") steps[2].is_error = true;
    if (scenario === "invalid citation bounds") content.annotations = [{ type: "url_citation", url: "https://example.com", title: "Panel", start_index: 0, end_index: 9000 }];
    if (scenario === "private citation") content.annotations = [{ type: "url_citation", url: "https://127.0.0.1/panel", title: "Panel", start_index: 0, end_index: 2 }];
    if (scenario === "unsafe widget") steps[2].result = [{ search_suggestions: '<a href="javascript:alert(1)">Search</a>' }];
    if (scenario === "custom tool") steps.push({ type: "function_call", name: "save_food" });
    if (scenario === "noncompleted") payload.status = "incomplete";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    await expect(geminiGrounded(query, { ...options(), fetch: fetcher })).rejects.toThrow("invalid_response");
  });
  it("rejects a citation splitting a UTF8 character", async () => {
    const payload = grounded("Café"); payload.steps[payload.steps.length - 1] = output("Café", [{ type: "url_citation", url: "https://example.com", title: "Panel", start_index: 0, end_index: 4 }]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    await expect(geminiGrounded(query, { ...options(), fetch: fetcher })).rejects.toThrow("invalid_response");
  });
});

describe("Grounding display safety", () => {
  it("accepts inert CSS/SVG Search Suggestions", () => expect(validateSuggestionsHtml(suggestions)).toBe(true));
  it.each([":host", ":host(.fullscreen)", ":host-context(body)", "::slotted(*)", "::part(controls)", ":ho/**/st", ":HOST"])("rejects shadow selectors that can escape widget isolation: %s", selector => {
    const widget = `<style>${selector}{position:fixed!important;inset:0!important;z-index:999999}</style><a href="https://www.google.com/search?q=egg">Search</a>`;
    expect(validateSuggestionsHtml(widget)).toBe(false);
  });
  it.each([
    '<script>alert(1)</script>', '<iframe src="https://google.com"></iframe>', '<form action="https://google.com"></form>',
    '<a href="https://google.com" onclick="alert(1)">Search</a>', '<a href="jav&#97;script:alert(1)">Search</a>',
    '<svg><foreignObject><script>alert(1)</script></foreignObject></svg>', '<svg><use href="https://evil.example/x.svg#id" /></svg>',
    '<img src="https://evil.example/track">', '<style>@import "https://evil.example/x.css";</style>',
    '<style>.x{background:url(https://evil.example/track)}</style>', '<style>.x{background:u\\72l(https://evil.example/track)}</style>',
    '<a href="https://127.0.0.1">Search</a>', '<a href="https://evil.example">Search</a>',
    '<a href=https://google.com onclick=alert(1)>Search</a>', '<div><svg></div></svg>',
  ])("rejects unsafe widget %s", (value) => expect(validateSuggestionsHtml(value)).toBe(false));
  it.each(["https://localhost/a", "https://internal.local/a", "https://127.1/a", "https://10.0.0.1/a", "https://192.168.1.1/a", "https://169.254.169.254/latest", "https://[::1]/a", "https://[fc00::1]/a", "https://example.com@127.0.0.1/a", "javascript:alert(1)", "http://example.com/a", "https://user:pass@example.com/a", "https://127.0.0.1.nip.io/a", "https://127.0.0.1.sslip.io/a", "https://localtest.me/a", "https://internal.example/a", "https://intranet/a"])("rejects unsafe citation URL %s", (url) => expect(isSafeGroundingUrl(url)).toBe(false));
  it.each(["https://example.com/panel?x=1", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/123", "https://www.rebisco.com.ph/products"])("accepts public HTTPS URL %s", (url) => expect(isSafeGroundingUrl(url)).toBe(true));
});
