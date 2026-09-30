import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountDay, getAccountDay } from './accountDay';
import { supabase } from './supabase';
vi.mock('./supabase', () => ({supabase: {from: vi.fn()}}));
describe('the account diary day', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses Manila midnight even when the device runs in another timezone', () => {
    const day = accountDay('Asia/Manila', new Date('2026-09-27T16:00:00Z'));
    expect(day).toEqual({date:'2026-09-28',timeZone:'Asia/Manila',start:'2026-09-27T16:00:00.000Z',end:'2026-09-28T16:00:00.000Z'});
  });
  it('keeps explicit next-midnight boundaries over the spring DST transition', () => {
    const day = accountDay('America/New_York',new Date('2026-03-08T12:00:00Z'));
    expect(Date.parse(day.end)-Date.parse(day.start)).toBe(23*3600000);
    expect(day.date).toBe('2026-03-08');
  });
  it('keeps the full 25-hour autumn day', () => {
    const day = accountDay('America/New_York',new Date('2026-11-01T12:00:00Z'));
    expect(Date.parse(day.end)-Date.parse(day.start)).toBe(25*3600000);
  });
  it('reads only the requested owner and does not retain another account zone',async () => {
    const eq=vi.fn();const single=vi.fn().mockResolvedValueOnce({data:{time_zone:'Asia/Manila'},error:null}).mockResolvedValueOnce({data:{time_zone:'America/New_York'},error:null});
    const select=vi.fn(()=>({eq}));eq.mockReturnValue({maybeSingle:single});vi.mocked(supabase.from).mockReturnValue({select} as unknown as ReturnType<typeof supabase.from>);
    expect((await getAccountDay('owner-a',new Date('2026-09-27T16:00:00Z'))).date).toBe('2026-09-28');
    expect((await getAccountDay('owner-b',new Date('2026-09-27T16:00:00Z'))).date).toBe('2026-09-27');
    expect(eq.mock.calls).toEqual([['user_id','owner-a'],['user_id','owner-b']]);
  });
  it('fails a saved-zone read rather than writing a summary for the wrong day',async () => {
    vi.mocked(supabase.from).mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:{message:'unavailable'}})})})} as unknown as ReturnType<typeof supabase.from>);
    await expect(getAccountDay('owner-a')).rejects.toThrow('Account date unavailable');
  });
});
