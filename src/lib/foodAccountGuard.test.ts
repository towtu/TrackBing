import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { createFoodAccountGuard } from "./foodAccountGuard";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() } } }));
const getSession = vi.mocked(supabase.auth.getSession);
const getUser = vi.mocked(supabase.auth.getUser);
let changed: Parameters<typeof supabase.auth.onAuthStateChange>[0];

function session(id = "account-a", token = "token-account-a") {
  return { user: { id }, access_token: token } as NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>;
}
function setUser(id = "account-a", token = "token-account-a") {
  getSession.mockResolvedValue({ data: { session: session(id, token) }, error: null });
}

describe("food save account guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setUser();
    getUser.mockResolvedValue({ data: { user: session().user }, error: null });
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      changed = callback;
      return { data: { subscription: { id: "guard-fixture", callback, unsubscribe: vi.fn() } } };
    });
  });

  it("never rebinds an old form when deferred verification resolves after account switch", async () => {
    let complete!: (value: Awaited<ReturnType<typeof supabase.auth.getUser>>) => void;
    getUser.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const guard = createFoodAccountGuard();
    const pending = guard.authorize();
    await vi.waitFor(() => expect(getUser).toHaveBeenCalledWith("token-account-a"));
    setUser("account-b", "token-account-b");
    changed("SIGNED_IN", session("account-b", "token-account-b"));
    complete({ data: { user: session("account-b").user }, error: null });
    expect(await pending).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    guard.dispose();
  });

  it("ignores a deferred save authorization after the screen unmounts", async () => {
    let complete!: (value: Awaited<ReturnType<typeof supabase.auth.getUser>>) => void;
    getUser.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const guard = createFoodAccountGuard();
    const pending = guard.authorize();
    await vi.waitFor(() => expect(getUser).toHaveBeenCalled());
    guard.dispose();
    complete({ data: { user: session().user }, error: null });
    expect(await pending).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("binds authorized writes to the verified JWT and invalidates later mutations on switch", async () => {
    const guard = createFoodAccountGuard();
    const writer = await guard.authorize();
    expect(writer?.userId).toBe("account-a");
    expect(writer?.isActive()).toBe(true);
    const options = vi.mocked(createClient).mock.calls[0]?.[2];
    expect(await options?.accessToken?.()).toBe("token-account-a");
    changed("SIGNED_IN", session("account-b", "token-account-b"));
    expect(writer?.isActive()).toBe(false);
    expect(await options?.accessToken?.()).toBeNull();
    guard.dispose();
  });
});
