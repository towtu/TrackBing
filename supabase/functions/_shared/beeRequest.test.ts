import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedRequestJson } from "./beeRequest.ts";

const request = (body: BodyInit = '{"ready":true}', headers: Record<string, string> = {}, signal?: AbortSignal) => new Request("https://trackbing.example", { method: "POST", body, headers: { "content-type": "application/json", ...headers }, signal, duplex: "half" } as RequestInit);
afterEach(() => vi.useRealTimers());

describe("Bounded Bee request JSON", () => {
  it("parses a valid request with UTF8 split across streamed chunks", async () => {
    const bytes = new TextEncoder().encode('{"name":"Café"}');
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); } });
    await expect(readBoundedRequestJson(request(body))).resolves.toEqual({ name: "Café" });
  });
  it("rejects an advertised body larger than the cap", async () => {
    await expect(readBoundedRequestJson(request("{}", { "content-length": "8193" }))).rejects.toThrow("bad_request");
  });
  it("enforces streamed byte limits without Content-Length", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { cancelled(); } });
    await expect(readBoundedRequestJson(request(body))).rejects.toThrow("bad_request");
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("refuses malformed UTF8 instead of accepting replacement characters", async () => {
    const body = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
    await expect(readBoundedRequestJson(request(body))).rejects.toThrow(/^bad_request$/);
  });
  it("normalizes malformed JSON errors", async () => {
    await expect(readBoundedRequestJson(request('{"ready":'))).rejects.toThrow(/^bad_request$/);
  });
  it("rejects requests aborted before reading", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readBoundedRequestJson(request("{}", {}, controller.signal))).rejects.toThrow("bad_request");
  });
  it("cancels a blocked request reader when its caller aborts", async () => {
    const controller = new AbortController(); const cancelled = vi.fn();
    const body = new ReadableStream({ cancel() { cancelled(); } });
    const result = readBoundedRequestJson(request(body, {}, controller.signal));
    const rejected = expect(result).rejects.toThrow("bad_request");
    controller.abort(); await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("cancels a blocked request reader after five seconds", async () => {
    vi.useFakeTimers(); const cancelled = vi.fn();
    const body = new ReadableStream({ cancel() { cancelled(); } });
    const result = readBoundedRequestJson(request(body));
    await Promise.all([expect(result).rejects.toThrow("bad_request"), vi.advanceTimersByTimeAsync(5000)]);
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each(["text/plain", "application/json-invalid"])("rejects an invalid content type %s", async contentType => {
    await expect(readBoundedRequestJson(request("{}", { "content-type": contentType }))).rejects.toThrow("bad_request");
  });
});
