/** Streaming byte cap, fatal UTF8 decoding, cancellation and a five-second body deadline. */
export async function readBoundedRequestJson(request: Request, maximum = 8192): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType) || Number(request.headers.get("content-length")) > maximum || !request.body) throw new Error("bad_request");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("bad_request")), 5000); });
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new Error("bad_request"));
  request.signal.addEventListener("abort", onAbort, { once: true });
  let body = "";
  let bytes = 0;
  try {
    if (request.signal.aborted) throw new Error("bad_request");
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline, aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error("bad_request");
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch {
    throw new Error("bad_request");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
    // Best-effort cleanup also cancels maliciously slow bodies and interrupted reads.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
