import { useEffect, useRef, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { TrackingAction, TrackingPage, trackingStyles as styles } from '@/src/components/tracking/TrackingPage';
import { useTrackingAccount } from '@/src/lib/useTrackingAccount';
import { createTrackingExport, exportCsv, readTrackingRows, trackingRange, TRACKING_FIELDS, type TrackingTable, type TrackingRow } from '@/src/lib/trackingData';
import { saveTrackingFile } from '@/src/lib/saveTrackingFile';
import { shiftDay } from '../../supabase/functions/_shared/beeDates';

export function DataExportScreen() {
  const {day,error:accountError,authorize,reload} = useTrackingAccount();
  const [from,setFrom] = useState(''); const [to,setTo] = useState('');
  const [initialized,setInitialized] = useState(false);
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [status,setStatus] = useState('');
  const active = useRef(true); const writing = useRef(false); const abort = useRef<AbortController | null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;abort.current?.abort();};},[]);
  useEffect(()=>{if(day){setFrom(shiftDay(day.date,-29));setTo(day.date);setInitialized(true);}},[day]);
  async function download(kind:'json' | 'food_logs' | 'weight_logs') {
    if (writing.current || !day) return;
    writing.current=true;setBusy(true);setError('');setStatus('Preparing your download…');
    const controller = new AbortController(); abort.current=controller;
    const timer=setTimeout(()=>controller.abort(),45000);
    try {
      const range=trackingRange(from,to,day.timeZone);
      if(to>day.date) throw new Error('Choose today or an earlier end date.');
      const owner=await authorize(); const started=new Date();
      let content:string;
      if(kind==='json') {
        const records={} as Record<TrackingTable,TrackingRow[]>;
        for(const table of Object.keys(TRACKING_FIELDS) as TrackingTable[]) records[table]=await readTrackingRows(owner,table,range,{signal:controller.signal,cutoff:started.toISOString()});
        content=createTrackingExport(records,range,started);
      } else content=exportCsv(await readTrackingRows(owner,kind,range,{signal:controller.signal,cutoff:started.toISOString()}),kind);
      clearTimeout(timer);
      if (!active.current || !owner.isActive()) throw new Error('Your account changed. Start the download again.');
      const name=`trackbing-${kind==='json' ? 'tracking' : kind==='food_logs' ? 'food' : 'weight'}-${from}-${to}.${kind==='json' ? 'json' : 'csv'}`;
      await saveTrackingFile(name,content,()=>active.current && owner.isActive());
      if(active.current && owner.isActive()) setStatus(Platform.OS === 'web' ? 'Download started. Keep the file somewhere private.' : 'Share sheet closed. If you saved a copy, keep it somewhere private.');
    } catch(failure) {
      if(active.current){setStatus('');setError(failure instanceof Error ? failure.message : 'Could not prepare your download. Try again.');}
    } finally {clearTimeout(timer);writing.current=false;if(active.current)setBusy(false);}
  }
  return <TrackingPage title="Your tracking data" description="Save a private copy of your food diary and dated weight history. Downloads go directly to your device.">
    {accountError && <><Text accessibilityRole="alert" style={styles.error}>{accountError}</Text><TrackingAction label="Reload account date" onPress={()=>void reload()} /></>}
    <View style={styles.section}>
      <Text style={styles.text}>Choose a date range</Text>
      <Text style={styles.copy}>Up to 366 days. Dates use {day?.timeZone ?? 'your account timezone'}.</Text>
      <View style={styles.row}>
        <View style={styles.field}><Text style={styles.label}>From (YYYY-MM-DD)</Text><TextInput accessibilityLabel="Export start date" value={from} onChangeText={setFrom} editable={!busy && !!day && initialized} maxLength={10} autoCapitalize="none" autoCorrect={false} style={styles.input} /></View>
        <View style={styles.field}><Text style={styles.label}>To (YYYY-MM-DD)</Text><TextInput accessibilityLabel="Export end date" value={to} onChangeText={setTo} editable={!busy && !!day && initialized} maxLength={10} autoCapitalize="none" autoCorrect={false} style={styles.input} /></View>
      </View>
      <TrackingAction label="Download tracking JSON" primary disabled={busy || !day || !from || !to} busy={busy} onPress={()=>void download('json')} />
      <Text style={styles.copy}>Includes food and weight entries in this range, plus your current profile settings, personal foods, recipes and saved preferences.</Text>
      <View style={styles.row}>
        <TrackingAction label="Food diary CSV" disabled={busy || !day || !from || !to} onPress={()=>void download('food_logs')} />
        <TrackingAction label="Weight history CSV" disabled={busy || !day || !from || !to} onPress={()=>void download('weight_logs')} />
      </View>
      {!!status && <Text accessibilityLiveRegion="polite" style={styles.text}>{status}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>
    <Text style={styles.copy}>Chat, Google Search answers, billing records, sign-in credentials and undated baseline weights are excluded. JSON includes your current profile weight. The export reads saved records as they are loaded; avoid editing them during a download.</Text>
    <Text style={styles.copy}>A downloaded copy may contain body measurements and food history. Deleting records from TrackBing won’t delete copies you save or share. No file is uploaded by this feature.</Text>
  </TrackingPage>;
}
