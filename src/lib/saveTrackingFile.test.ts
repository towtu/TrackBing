import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_EXPORT_BYTES } from './trackingData';
import { validateTrackingFile } from './trackingFilePolicy';
import { saveTrackingFile } from './saveTrackingFile.native';
const mocks=vi.hoisted(()=>({available:vi.fn(),share:vi.fn(),create:vi.fn(),write:vi.fn(),remove:vi.fn(),file:vi.fn()}));
vi.mock('expo-sharing',()=>({isAvailableAsync:mocks.available,shareAsync:mocks.share}));
vi.mock('expo-file-system',()=>({Paths:{cache:'private-cache'},File:class {
  exists=true;uri='file:///private-cache/fixture.csv';
  constructor(...args:unknown[]){mocks.file(...args);}
  create=mocks.create;write=mocks.write;delete=mocks.remove;
}}));
describe('private file delivery',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.available.mockResolvedValue(true);mocks.share.mockResolvedValue(undefined);});
  it('rejects traversal names, oversized downloads and account changes before delivery',()=>{
    expect(()=>validateTrackingFile('../secret.json','x',()=>true)).toThrow();
    expect(()=>validateTrackingFile('trackbing-food.csv','x'.repeat(MAX_EXPORT_BYTES+1),()=>true)).toThrow('large');
    expect(()=>validateTrackingFile('trackbing-food.csv','x',()=>false)).toThrow('account');
  });
  it('deletes temporary native files after success and after a failed share',async()=>{
    await saveTrackingFile('trackbing-food.csv','test data',()=>true);
    expect(mocks.write).toHaveBeenCalledWith('test data');expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledWith('file:///private-cache/fixture.csv',expect.objectContaining({mimeType:'text/csv'}));
    mocks.share.mockRejectedValueOnce(new Error('share failed'));
    await expect(saveTrackingFile('trackbing-food.csv','test data',()=>true)).rejects.toThrow('Could not share');
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });
  it('does not write or share after availability check resolves into another account',async()=>{
    let active=true; mocks.available.mockImplementationOnce(async()=>{active=false;return true;});
    await expect(saveTrackingFile('trackbing-food.csv','test data',()=>active)).rejects.toThrow('account');
    expect(mocks.write).not.toHaveBeenCalled();expect(mocks.share).not.toHaveBeenCalled();
  });
  it('offers web download when native sharing is unavailable',async()=>{
    mocks.available.mockResolvedValueOnce(false);
    await expect(saveTrackingFile('trackbing-food.csv','test data',()=>true)).rejects.toThrow('web');
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it('does not disclose private cache paths when temporary cleanup fails',async()=>{
    mocks.remove.mockImplementationOnce(()=>{throw new Error('private/cache/internal-path');});
    await expect(saveTrackingFile('trackbing-food.csv','test data',()=>true)).rejects.toThrow('Could not remove the temporary download');
  });
});
