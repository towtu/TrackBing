import type { SupabaseClient } from '@supabase/supabase-js';
import { dayBounds, validTimeZone } from '../../supabase/functions/_shared/beeDates';

export const TRACKING_FIELDS = {
  food_logs: ['id','name','calories','protein','carbs','fat','serving_size','serving_unit','ai_estimated','barcode','created_at','bee_provenance'],
  weight_logs: ['id','weight_kg','original_amount','unit','measured_at','local_date','time_zone','source','created_at'],
  user_goals: ['id','current_weight','target_weight','height','age','gender','activity_level','calorie_target','protein_grams','carbs_grams','fat_grams','protein_ratio','carbs_ratio','fat_ratio','goal_mode','goal_rate','unit_system','time_zone','maintenance_calories','calculation_method'],
  personal_foods: ['id','name','calories','protein','carbs','fat','default_unit','ai_estimated','created_at'],
  recipes: ['id','name','ingredients','created_at'],
  bee_memories: ['key','value','source','created_at','updated_at'],
} as const;
export type TrackingTable = keyof typeof TRACKING_FIELDS;
export type TrackingRow = Record<string, unknown>;
export type TrackingOwner = {client:SupabaseClient;userId:string;isActive:()=>boolean};
export type TrackingRange = {from:string;to:string;timeZone:string;start:string;end:string};
export const MAX_EXPORT_BYTES = 3 * 1024 * 1024;

export function trackingRange(from: string, to: string, timeZone: string): TrackingRange {
  if (!validTimeZone(timeZone)) throw new Error('Your timezone is unavailable. Reload your saved profile.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from < '1900-01-01' || to > '2100-12-31') throw new Error('Enter a real date as YYYY-MM-DD.');
  const days = (Date.parse(to+'T00:00:00Z') - Date.parse(from+'T00:00:00Z')) / 86400000 + 1;
  if (!Number.isFinite(days) || days < 1 || days > 366) throw new Error('Choose a date range of 1 to 366 days, with the start before the end.');
  try { return {from,to,timeZone,start:dayBounds(from,timeZone).start,end:dayBounds(to,timeZone).end}; }
  catch { throw new Error('Enter a real date as YYYY-MM-DD.'); }
}
function assertOwner(owner: TrackingOwner) {
  if (!owner.isActive()) throw new Error('Your account changed. Sign in again before loading private data.');
}
function projectRow(value: TrackingRow, table: TrackingTable): TrackingRow {
  return Object.fromEntries(TRACKING_FIELDS[table].filter(key => Object.hasOwn(value,key)).map(key=>[key,value[key]]));
}
/** Keyset pages continue to an empty page, including when a server caps page size. */
export async function readTrackingRows(owner: TrackingOwner, table: TrackingTable, range?: TrackingRange,
  options: {maxRows?:number;signal?:AbortSignal;cutoff?:string} = {}): Promise<TrackingRow[]> {
  const rows: TrackingRow[] = [];
  const key = table === 'bee_memories' ? 'key' : 'id';
  let last: string | null = null;
  const seen = new Set<string>();
  for (let page=0;page<50;page++) {
    assertOwner(owner);
    if (options.signal?.aborted) throw new Error('Loading took too long. Try a smaller date range.');
    let query = owner.client.from(table).select(TRACKING_FIELDS[table].join(',')).eq('user_id',owner.userId).order(key,{ascending:true}).limit(500);
    if (range && (table === 'food_logs' || table === 'weight_logs')) {
      const field = table === 'food_logs' ? 'created_at' : 'measured_at';
      query = query.gte(field,range.start).lt(field,range.end);
    }
    if (last) query = query.gt(key,last);
    if (options.cutoff && table !== 'user_goals') query = query.lte('created_at',options.cutoff);
    if (options.signal) query = query.abortSignal(options.signal);
    const {data,error} = await query;
    assertOwner(owner);
    if (error) throw new Error('Could not load your saved data. Check your connection and try again.');
    if (!Array.isArray(data)) throw new Error('Could not load your saved data. Try again.');
    if (data.length === 0) return rows;
    for (const raw of data as unknown[]) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Could not read a saved record.');
      const value = raw as TrackingRow;
      const id = value[key];
      if (typeof id !== 'string' || !id || seen.has(id)) throw new Error('Could not read a complete export. Please try again.');
      seen.add(id); last=id; rows.push(projectRow(value,table));
      if (rows.length > (options.maxRows ?? 10000)) throw new Error('Too many records. Choose a smaller date range.');
    }
    if (JSON.stringify(rows).length > MAX_EXPORT_BYTES) throw new Error('This download is too large. Choose a smaller date range.');
  }
  throw new Error('Too many pages. Choose a smaller date range.');
}
function csvValue(value: unknown) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function exportCsv(rows: TrackingRow[], table: 'food_logs' | 'weight_logs') {
  const columns = TRACKING_FIELDS[table].filter(field => field !== 'bee_provenance');
  return columns.join(',')+'\r\n'+rows.map(row=>columns.map(key=>csvValue(row[key])).join(',')).join('\r\n')+'\r\n';
}
export function createTrackingExport(records: Record<TrackingTable,TrackingRow[]>, range: TrackingRange, now = new Date()) {
  const safeRecords = Object.fromEntries((Object.keys(TRACKING_FIELDS) as TrackingTable[]).map(table=>[table,records[table].map(row=>projectRow(row,table))]));
  return JSON.stringify({format:'trackbing-tracking-v1',exported_at:now.toISOString(),range,
    note:'Dated food and weight records use this range. Profile, personal foods, recipes and saved preferences are current. Chat, billing, sessions and Google Search answers are excluded. Reads are not a transactional snapshot.',...safeRecords},null,2);
}
export function diaryTotals(rows: TrackingRow[]) {
  const result = {calories:0,protein:0,carbs:0,fat:0};
  for (const row of rows) for (const key of Object.keys(result) as (keyof typeof result)[]) {
    const value = row[key];
    const number = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(number) || number < 0) throw new Error('A saved food has incomplete nutrition. Review it in your diary before using totals.');
    result[key] += number;
  }
  return result;
}
