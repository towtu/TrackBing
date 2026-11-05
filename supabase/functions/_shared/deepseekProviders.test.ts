import { describe, expect, it, vi } from "vitest";
import {
  deepseekGrounded,
  deepseekJson,
  deepseekLabel,
} from "./deepseekProviders.ts";
const options = () => ({
  apiKey: "test-key",
  signal: new AbortController().signal,
});
const response = (content: unknown, finish = "stop") =>
  new Response(
    JSON.stringify({
      choices: [{
        finish_reason: finish,
        message: {
          content: JSON.stringify(content),
          reasoning_content: "PRIVATE",
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    }),
  );
describe("DeepSeek provider contract", () => {
  it("sends inline label pixels to Flash without tools, Search or reasoning", async () => {
    const image = "data:image/jpeg;base64," +
      btoa(
        String.fromCharCode(...[
          255,
          216,
          255,
          192,
          0,
          17,
          8,
          0,
          20,
          0,
          30,
          3,
          1,
          17,
          0,
          2,
          17,
          0,
          3,
          17,
          0,
          255,
          217,
        ]),
      );
    const label = {
      foodName: "TEST label",
      basis: "per_100g",
      servingGrams: null,
      servingDescription: null,
      energy: 100,
      energyUnit: "kcal",
      protein: null,
      carbs: 10,
      fat: 2,
      warnings: [],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(label));
    expect(await deepseekLabel(image, { ...options(), fetch: fetcher }))
      .toEqual(label);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "deepseek-flash",
      reasoning_effort: "none",
      max_tokens: 4096,
    });
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: image, detail: "high" },
    });
    expect(body).not.toHaveProperty("tools");
  });
  it("accepts an empty tool-call array but never executes model tools", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            finish_reason: "stop",
            message: { content: '{"kind":"chat"}', tool_calls: [] },
          }],
        }),
      ),
    );
    expect(await deepseekJson("JSON", {}, { ...options(), fetch: fetcher }))
      .toEqual({ kind: "chat" });
  });
  it("reports zero searches when a food identity fails preflight", async () => {
    const onUsage = vi.fn(), fetcher = vi.fn<typeof fetch>();
    await expect(
      deepseekGrounded({
        name: "x".repeat(150),
        preparation: null,
        brand: null,
        variant: null,
        packageGrams: null,
        market: null,
        portion: null,
      }, { ...options(), fetch: fetcher, onUsage }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 0,
      outputTokens: 0,
      searchQueries: 0,
    });
  });
  it("uses Pro with bounded hidden low reasoning and no model tools", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({ kind: "chat" }),
    );
    const usage = vi.fn();
    expect(
      await deepseekJson("Return JSON", {}, {
        ...options(),
        fetch: fetcher,
        onUsage: usage,
      }),
    ).toEqual({ kind: "chat" });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-pro",
      reasoning_effort: "low",
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("tools");
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
    expect(usage).toHaveBeenCalledWith({
      inputTokens: 12,
      outputTokens: 7,
      searchQueries: 0,
    });
  });
  it.each(["length", "tool_calls", "content_filter"])(
    "rejects incomplete or unexpected output %s",
    async (finish) => {
      await expect(
        deepseekJson("JSON", {}, {
          ...options(),
          fetch: vi.fn<typeof fetch>().mockResolvedValue(response({}, finish)),
        }),
      ).rejects.toThrow("invalid_response");
    },
  );
  it("does not silently substitute a different model", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      deepseekJson("JSON", {}, {
        ...options(),
        model: "gemini-3.8-flash",
        fetch: fetcher,
      }),
    ).rejects.toThrow("not_configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("searches once, binds citations to actual result URLs, and keeps profile out of search", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [{
            title: "Label",
            url: "https://example.com/label",
            content: "Product identity only.",
          }],
        }),
      ),
    ).mockResolvedValueOnce(
      response({
        text: "The product panel is not verified. Please enter its label.",
        sources: [0],
      }),
    );
    const usage = vi.fn();
    const q = {
      name: "Fudgee Barr",
      preparation: null,
      brand: "Rebisco",
      variant: "Chocolate",
      packageGrams: 38,
      market: "Philippines",
      portion: { amount: 1, unit: "bar" as const },
      profile: "PRIVATE",
    };
    const answer = await deepseekGrounded(q, {
      ...options(),
      fetch: fetcher,
      onUsage: usage,
    });
    expect(answer.provider).toBe("deepseek");
    expect(answer.citations[0].url).toBe("https://example.com/label");
    expect(answer.searchSuggestionsHtml).toEqual([]);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.count).toBe(5);
    expect(body.query).toContain("Chocolate");
    expect(body.query).not.toContain("PRIVATE");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(usage).toHaveBeenCalledWith({
      inputTokens: 12,
      outputTokens: 7,
      searchQueries: 1,
    });
  });
  it("rejects invented citations and precise unsupported nutrition claims", async () => {
    for (
      const answer of [{ text: "Unsupported", sources: [1] }, {
        text: "Contains 123 kcal.",
        sources: [0],
      }]
    ) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{
              title: "Product",
              url: "https://example.com/p",
              content: "Name only",
            }],
          }),
        ),
      ).mockResolvedValueOnce(response(answer));
      await expect(
        deepseekGrounded({
          name: "Food",
          preparation: null,
          brand: null,
          variant: null,
          packageGrams: null,
          market: null,
          portion: null,
        }, { ...options(), fetch: fetcher }),
      ).rejects.toThrow("invalid_response");
    }
  });
  it("requires the image-capable Flash model for photos", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      deepseekLabel("not-image", {
        ...options(),
        model: "deepseek-v4-pro",
        fetch: fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
