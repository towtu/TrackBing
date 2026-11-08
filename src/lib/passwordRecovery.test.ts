import { describe, expect, it, vi } from 'vitest';
import { createPasswordRecovery, validateRecoveryPassword } from './passwordRecovery';

function fixture() {
  const auth = {
    resetPasswordForEmail: vi.fn(async (_email: string) => ({ error: null })),
    verifyOtp: vi.fn(async (_input: { email: string; token: string; type: 'recovery' }) => ({ error: null, data: { user: { id: 'owner', email: 'test@example.test' }, session: { access_token: 'test-token' } } })),
    updateUser: vi.fn(async (_input: { password: string }) => ({ error: null })),
    signOut: vi.fn(async (_input: { scope: 'global' }) => ({ error: null })),
  };
  return { auth, recovery: createPasswordRecovery(auth) };
}
describe('email password recovery', () => {
  it('requires valid email and matching bounded passwords before contacting Auth', async () => {
    const {auth,recovery}=fixture();
    expect((await recovery.send('bad email')).ok).toBe(false);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    for (const [password, repeated] of [['short','short'],['password1','password2'],['x'.repeat(1025),'x'.repeat(1025)]]) expect(validateRecoveryPassword(password,repeated).ok).toBe(false);
    expect(validateRecoveryPassword('  exact password  ','  exact password  ')).toEqual({ok:true,password:'  exact password  '});
    expect((await recovery.finish('123456','password1','password1')).ok).toBe(false);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it('normalizes only email and uses the recovery OTP type', async () => {
    const {auth,recovery}=fixture();
    expect((await recovery.send(' test@example.test ')).ok).toBe(true);
    expect((await recovery.finish(' 123456 ',' exact password ',' exact password ')).ok).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({email:'test@example.test',token:'123456',type:'recovery'});
    expect(auth.updateUser).toHaveBeenCalledWith({password:' exact password '});
    expect(auth.signOut).toHaveBeenCalledWith({scope:'global'});
  });
  it('never changes a password for invalid/expired OTP or mismatched verification identity', async () => {
    const {auth,recovery}=fixture(); await recovery.send('test@example.test');
    auth.verifyOtp.mockResolvedValueOnce({error: {code:'otp_expired'} as never,data:{user:null as never,session:null as never}});
    expect((await recovery.finish('123456','password1','password1')).ok).toBe(false);
    auth.verifyOtp.mockResolvedValueOnce({error:null,data:{user:{id:'other',email:'other@example.test'},session:{access_token:'token'}}});
    expect((await recovery.finish('123456','password1','password1')).ok).toBe(false);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('keeps a verified session for a safe explicit retry after password policy failure', async () => {
    const {auth,recovery}=fixture(); await recovery.send('test@example.test');
    auth.updateUser.mockResolvedValueOnce({error:{code:'weak_password'} as never});
    expect((await recovery.finish('123456','password1','password1')).ok).toBe(false);
    expect((await recovery.finish('123456','stronger password','stronger password')).ok).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledTimes(2);
    // Success cannot be replayed into another write.
    expect((await recovery.finish('123456','password1','password1')).ok).toBe(false);
  });
  it('does not start a write after disposal while OTP verification is in flight', async () => {
    const {auth,recovery}=fixture(); await recovery.send('test@example.test');
    let release!: (value: Awaited<ReturnType<typeof auth.verifyOtp>>) => void;
    auth.verifyOtp.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const pending=recovery.finish('123456','password1','password1'); recovery.dispose();
    release({error:null,data:{user:{id:'owner',email:'test@example.test'},session:{access_token:'token'}}});
    expect((await pending).ok).toBe(false); expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('rejects double submits while a verified password write is pending', async () => {
    const {auth,recovery}=fixture(); await recovery.send('test@example.test');
    let release!: (value: {error:null}) => void;
    auth.updateUser.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const first=recovery.finish('123456','password1','password1');
    await vi.waitFor(()=>expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect((await recovery.finish('123456','password1','password1')).ok).toBe(false);
    release({error:null}); expect((await first).ok).toBe(true);
  });
  it('reports a successful password update separately from failed session revocation', async () => {
    const {auth,recovery}=fixture(); await recovery.send('test@example.test');
    auth.signOut.mockRejectedValueOnce(new Error('offline'));
    const result=await recovery.finish('123456','password1','password1');
    expect(result.ok).toBe(true); expect(result.message).toContain('password was changed');
    expect(result.message).toContain('sign out');
  });
  it('contains provider errors without exposing internal messages or promising delivery', async () => {
    const {auth,recovery}=fixture(); auth.resetPasswordForEmail.mockRejectedValueOnce(new Error('secret internal path'));
    const result=await recovery.send('test@example.test'); expect(result.ok).toBe(false); expect(result.message).not.toContain('secret');
    auth.resetPasswordForEmail.mockResolvedValueOnce({error:{status:429} as never});
    expect((await recovery.send('test@example.test')).message).toContain('wait');
  });
});
