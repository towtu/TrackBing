import { dayBounds, localDay, validTimeZone } from '../../supabase/functions/_shared/beeDates';
import { supabase } from './supabase';

/** Saved account zone wins; an unset zone uses the validated device zone. No owner cache. */
export function accountDay(timeZone: unknown, now = new Date()) {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = validTimeZone(timeZone) ? timeZone : validTimeZone(device) ? device : 'UTC';
  const date = localDay(now, zone);
  return { date, timeZone: zone, ...dayBounds(date, zone) };
}

export async function getAccountDay(userId: string, now = new Date(), client = supabase) {
  const { data, error } = await client.from('user_goals').select('time_zone').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Account date unavailable');
  return accountDay(data?.time_zone, now);
}
