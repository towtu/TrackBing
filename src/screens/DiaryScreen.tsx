import { Link } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { TrackingAction, TrackingPage, trackingStyles as styles } from '@/src/components/tracking/TrackingPage';
import { useTrackingAccount } from '@/src/lib/useTrackingAccount';
import { diaryTotals, readTrackingRows, trackingRange, type TrackingRow } from '@/src/lib/trackingData';
import { subscribeFoodLogChanged } from '@/src/lib/foodLogEvents';
import { shiftDay } from '../../supabase/functions/_shared/beeDates';
import { Colors } from '@/src/styles/colors';

export function DiaryScreen() {
  const {day,error:accountError,authorize,reload} = useTrackingAccount();
  const [date,setDate] = useState('');
  const [editing,setEditing] = useState('');
  const [rows,setRows] = useState<TrackingRow[]>([]);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const invalidate = useCallback(()=>{request.current++; abort.current?.abort();},[]);
  useEffect(()=>{if(day){setDate(day.date);setEditing(day.date);}},[day]);
  const load = useCallback(async () => {
    if (!day || !date) return;
    const revision = ++request.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current=controller;
    const timer = setTimeout(()=>controller.abort(),20000);
    setLoading(true); setError(''); setRows([]);
    try {
      const range = trackingRange(date,date,day.timeZone);
      const owner = await authorize();
      const records = await readTrackingRows(owner,'food_logs',range,{maxRows:1000,signal:controller.signal});
      diaryTotals(records); // Do not display manufactured totals for incomplete legacy rows.
      if (request.current === revision && owner.isActive()) setRows(records);
    } catch (failure) {
      if (request.current === revision) setError(failure instanceof Error ? failure.message : 'Could not load this day. Try again.');
    } finally { clearTimeout(timer); if(request.current === revision) setLoading(false); }
  },[authorize,date,day]);
  useEffect(()=>{
    void load();
    return invalidate;
  },[invalidate,load]);
  useEffect(()=>subscribeFoodLogChanged(()=>void load()),[load]);
  const totals = diaryTotals(rows);
  function choose(value:string) {
    try {
      if (!day) return;
      trackingRange(value,value,day.timeZone);
      if (value > day.date) throw new Error('Choose today or an earlier day.');
      setError('');
      if(value !== date){setRows([]);setLoading(true);}
      setDate(value);setEditing(value);
    } catch (failure) {setError(failure instanceof Error ? failure.message : 'Choose a real date.');}
  }
  return <TrackingPage title="Food diary" description="Browse your saved food, one day at a time. These totals come from your recorded entries.">
    {accountError && <><Text accessibilityRole="alert" style={styles.error}>{accountError}</Text><TrackingAction label="Reload account date" onPress={()=>void reload()} /></>}
    {!day && !accountError && <ActivityIndicator accessibilityLabel="Loading your account date" color={Colors.accent} />}
    {day && <>
      <Text style={styles.copy}>Dates use {day.timeZone}. Historical nutrition targets are not stored here.</Text>
      <View style={styles.row}>
        <View style={styles.field}><Text style={styles.label}>Day (YYYY-MM-DD)</Text><TextInput accessibilityLabel="Diary date" value={editing} onChangeText={setEditing} maxLength={10} autoCapitalize="none" autoCorrect={false} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textSecondary} style={styles.input} onSubmitEditing={()=>choose(editing)} returnKeyType="go" /></View>
        <TrackingAction label="Show day" onPress={()=>choose(editing)} />
      </View>
      <View style={styles.row}>
        <TrackingAction label="Previous day" disabled={!date || date <= '1900-01-01'} onPress={()=>choose(shiftDay(date,-1))} />
        <TrackingAction label="Today" onPress={()=>choose(day.date)} />
        <TrackingAction label="Next day" disabled={!date || date >= day.date} onPress={()=>choose(shiftDay(date,1))} />
        <TrackingAction label="Refresh diary" disabled={loading} onPress={()=>void load()} />
      </View>
      <Text accessibilityRole="header" style={styles.text}>Food recorded for {date}</Text>
      {loading ? <ActivityIndicator accessibilityLabel="Loading food diary" color={Colors.accent} /> : error ? <View style={styles.section}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><TrackingAction label="Retry diary" onPress={()=>void load()} /></View> : <>
        <View style={styles.section}>
          <Text accessibilityLabel={`Daily total ${Math.round(totals.calories)} calories`} style={[styles.title,{fontSize:24}]}>{Math.round(totals.calories)} kcal</Text>
          <Text style={styles.copy}>Protein {totals.protein.toFixed(1)} g · Carbs {totals.carbs.toFixed(1)} g · Fat {totals.fat.toFixed(1)} g</Text>
          <Text style={styles.copy}>{rows.length} recorded {rows.length === 1 ? 'item' : 'items'}</Text>
        </View>
        {!rows.length && <Text style={styles.text}>No food entries saved for this day.</Text>}
        {rows.map(row=><View key={String(row.id)} style={styles.section}>
          <Text style={[styles.text,{fontWeight:'600'}]}>{String(row.name)}</Text>
          <Text style={styles.copy}>{row.serving_size ? `${row.serving_size} ${row.serving_unit ?? ''} · ` : ''}{typeof row.created_at === 'string' ? new Date(row.created_at).toLocaleTimeString(undefined,{timeZone:day.timeZone,hour:'numeric',minute:'2-digit'}) : ''}</Text>
          <Text style={styles.text}>{Math.round(Number(row.calories))} kcal</Text>
          <Text style={styles.copy}>Protein {Number(row.protein).toFixed(1)} g · Carbs {Number(row.carbs).toFixed(1)} g · Fat {Number(row.fat).toFixed(1)} g</Text>
          {row.ai_estimated === true && <Text style={{color:Colors.accent}}>AI estimate</Text>}
        </View>)}
      </>}
      {date === day.date && <Link href="/add" style={styles.link}>Log food for today</Link>}
      <Link href="/data" style={styles.link}>Download your tracking data</Link>
    </>}
  </TrackingPage>;
}
