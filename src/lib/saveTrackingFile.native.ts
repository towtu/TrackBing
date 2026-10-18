import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { validateTrackingFile } from './trackingFilePolicy';

export async function saveTrackingFile(name: string, content: string, isActive: () => boolean) {
  validateTrackingFile(name,content,isActive);
  let available = false;
  try { available = await isAvailableAsync(); }
  catch { throw new Error('File sharing is unavailable on this device. Use TrackBing on the web to download.'); }
  if (!available) throw new Error('File sharing is unavailable on this device. Use TrackBing on the web to download.');
  if (!isActive()) throw new Error('Your account changed. Start the download again.');
  let file: File | null = null;
  try {
    file = new File(Paths.cache,`${Date.now()}-${name}`);
    file.create({overwrite:true}); file.write(content);
    if (!isActive()) throw new Error('Your account changed. Start the download again.');
    await shareAsync(file.uri,{mimeType:name.endsWith('.json') ? 'application/json' : 'text/csv',UTI:name.endsWith('.json') ? 'public.json' : 'public.comma-separated-values-text',dialogTitle:'Save your TrackBing data'});
  } catch {
    if (!isActive()) throw new Error('Your account changed. Start the download again.');
    throw new Error('Could not share your download. Check your device storage and try again.');
  } finally {
    try { if (file?.exists) file.delete(); }
    catch { throw new Error('Could not remove the temporary download. Check your device storage before trying again.'); }
  }
}
