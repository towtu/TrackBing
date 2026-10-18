const listeners = new Set<()=>void>();
export function openBee():void {listeners.forEach(listener=>listener());}
export function onOpenBee(listener:()=>void):()=>void {listeners.add(listener);return ()=>{listeners.delete(listener);};}
