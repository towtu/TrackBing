import { validateTrackingFile } from './trackingFilePolicy';
/** Web download. Native resolves saveTrackingFile.native.ts instead. */
export async function saveTrackingFile(name: string, content: string, isActive: () => boolean) {
  validateTrackingFile(name,content,isActive);
  const url = URL.createObjectURL(new Blob([content],{type:name.endsWith('.json') ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'}));
  try {
    const anchor = document.createElement('a'); anchor.href=url; anchor.download=name;
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } finally { setTimeout(()=>URL.revokeObjectURL(url),1000); }
}
