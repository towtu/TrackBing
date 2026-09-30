import { useCallback, useEffect, useRef, useState } from 'react';
import { createFoodAccountGuard } from './foodAccountGuard';
import { getAccountDay } from './accountDay';

export function useTrackingAccount() {
  const guard = useRef<ReturnType<typeof createFoodAccountGuard> | null>(null);
  const generation = useRef(0);
  const [day,setDay] = useState<Awaited<ReturnType<typeof getAccountDay>> | null>(null);
  const [error,setError] = useState('');
  const invalidate = useCallback(()=>{generation.current++;},[]);
  const authorize = useCallback(async () => {
    const owner = await guard.current?.authorize();
    if (!owner) throw new Error('Your sign-in changed. Sign in again to view your data.');
    return owner;
  },[]);
  const reload = useCallback(async () => {
    const revision = ++generation.current;
    setDay(null); setError('');
    try {
      const owner = await authorize();
      const current = await getAccountDay(owner.userId,new Date(),owner.client);
      if (revision === generation.current && owner.isActive()) setDay(current);
    } catch {
      if (revision === generation.current && guard.current) setError('Could not load your account date. Check your sign-in and connection, then try again.');
    }
  },[authorize]);
  useEffect(() => {
    const account = createFoodAccountGuard(); guard.current = account;
    void reload();
    return () => {invalidate(); account.dispose(); guard.current=null;};
  },[invalidate,reload]);
  return {day,error,authorize,reload};
}
