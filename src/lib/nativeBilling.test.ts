import {beforeEach, expect, it, vi} from 'vitest';
import {connectStore} from './nativeBilling.native';
const sdk=vi.hoisted(()=>({initConnection:vi.fn(),fetchProducts:vi.fn(),endConnection:vi.fn(),purchaseUpdatedListener:vi.fn(),remove:vi.fn()}));
vi.mock('react-native',()=>({Platform:{OS:'ios'}}));
vi.mock('expo-iap',()=>sdk);
vi.mock('./billing',()=>({billingRequest:vi.fn()}));
const catalog={products:[{provider:'apple' as const,id:'fixture.plus',tier:'plus' as const,interval:'monthly' as const}],apple_account_token:'fixture',google_account_id:'fixture',web_enabled:false,sandbox:true};
beforeEach(()=>{vi.clearAllMocks();sdk.initConnection.mockResolvedValue(true);sdk.endConnection.mockResolvedValue(undefined);sdk.purchaseUpdatedListener.mockReturnValue({remove:sdk.remove});});
it('releases the store listener and connection when product loading fails',async()=>{
 sdk.fetchProducts.mockRejectedValue(new Error('Store unavailable'));
 await expect(connectStore(catalog,'owner',vi.fn())).rejects.toThrow('Store unavailable');
 expect(sdk.remove).toHaveBeenCalledTimes(1);expect(sdk.endConnection).toHaveBeenCalledTimes(1);
});
it('disposes a successfully loaded native store without leaving a listener',async()=>{
 sdk.fetchProducts.mockResolvedValue([]);
 const store=await connectStore(catalog,'owner',vi.fn());store.dispose();
 expect(sdk.remove).toHaveBeenCalledTimes(1);expect(sdk.endConnection).toHaveBeenCalledTimes(1);
});
