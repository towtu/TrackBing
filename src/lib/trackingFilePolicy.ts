import { MAX_EXPORT_BYTES } from './trackingData';

export function validateTrackingFile(name: string, content: string, isActive: () => boolean) {
  if (!isActive()) throw new Error('Your account changed. Start the download again.');
  if (!/^trackbing-[a-z0-9-]+\.(json|csv)$/.test(name)) throw new Error('Invalid download name.');
  if (new TextEncoder().encode(content).byteLength > MAX_EXPORT_BYTES) throw new Error('This download is too large. Choose a smaller date range.');
}
