type Listener = (kind:"personal_food"|"recipe")=>void;
const listeners=new Set<Listener>();
export function subscribeFoodLibraryChanged(listener:Listener) { listeners.add(listener); return ()=>{listeners.delete(listener);}; }
export function emitFoodLibraryChanged(kind:"personal_food"|"recipe") { listeners.forEach(listener=>listener(kind)); }
