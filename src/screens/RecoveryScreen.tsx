import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, Radii } from '@/src/styles/colors';
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '@/src/lib/authValidation';
import { createRecoveryClient } from '@/src/lib/recoveryClient';
import { supabase } from '@/src/lib/supabase';
import { LegalLinks } from '@/src/components/legal/LegalLinks';

export function RecoveryScreen() {
  const recovery = useRef<ReturnType<typeof createRecoveryClient> | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [stage, setStage] = useState<'email' | 'code' | 'done'>('email');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [visible, setVisible] = useState(false);
  const codeInput = useRef<TextInput>(null);
  useEffect(() => {
    const controller = createRecoveryClient(); recovery.current = controller;
    let active = true;
    void supabase.auth.getSession().then(({data}) => { if (active) setEmail(data.session?.user.email ?? ''); }).catch(() => { /* An empty editable email is a safe fallback. */ });
    return () => { active = false; controller.dispose(); recovery.current = null; };
  }, []);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0,value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  useEffect(() => { if (stage === 'code') codeInput.current?.focus(); }, [stage]);
  async function send() {
    if (busy || !recovery.current) return;
    setBusy(true); setMessage('');
    const result = await recovery.current.send(email);
    if (!recovery.current) return;
    setBusy(false); setError(!result.ok); setMessage(result.message);
    if (result.ok) { setStage('code'); setRemaining(60); setCode(''); }
  }
  async function finish() {
    if (busy || !recovery.current) return;
    setBusy(true); setMessage('');
    const result = await recovery.current.finish(code,password,repeated);
    if (!recovery.current) return;
    setBusy(false); setError(!result.ok); setMessage(result.message);
    if (result.ok) { setStage('done'); setPassword(''); setRepeated(''); setCode(''); }
  }
  function restart() {
    recovery.current?.dispose(); recovery.current = createRecoveryClient();
    setStage('email'); setCode(''); setPassword(''); setRepeated(''); setMessage('');
  }
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Link href="/" style={styles.link}>Back to TrackBing</Link>
        <Text accessibilityRole="header" style={styles.title}>{stage === 'done' ? 'Password changed' : 'Reset your password'}</Text>
        <Text style={styles.copy}>{stage === 'email' ? 'We’ll send a verification code to your registered email. Gmail and other email providers work.' : stage === 'code' ? `Enter the code sent to ${email.trim()} and choose a new password.` : 'Your food diary, preferences and goals stay with your account.'}</Text>
        {stage === 'email' && <>
          <Text style={styles.label}>Email address</Text>
          <TextInput style={styles.input} accessibilityLabel="Recovery email address" value={email} onChangeText={setEmail} editable={!busy} maxLength={MAX_EMAIL_LENGTH} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" onSubmitEditing={() => void send()} returnKeyType="send" />
        </>}
        {stage === 'code' && <>
          <Text style={styles.label}>Email verification code</Text>
          <TextInput ref={codeInput} style={styles.input} accessibilityLabel="Recovery verification code" value={code} onChangeText={setCode} editable={!busy} maxLength={6} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoCapitalize="none" />
          <Text style={styles.label}>New password</Text>
          <TextInput style={styles.input} accessibilityLabel="New password" value={password} onChangeText={setPassword} editable={!busy} secureTextEntry={!visible} maxLength={MAX_PASSWORD_LENGTH} autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" autoCorrect={false} />
          <Text style={styles.copy}>Use at least 8 characters. A longer, unique password is safer.</Text>
          <Text style={styles.label}>Repeat new password</Text>
          <TextInput style={styles.input} accessibilityLabel="Repeat new password" value={repeated} onChangeText={setRepeated} editable={!busy} secureTextEntry={!visible} maxLength={MAX_PASSWORD_LENGTH} autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => void finish()} />
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide passwords' : 'Show passwords'} onPress={() => setVisible(value => !value)} style={styles.secondary}><Text style={styles.linkText}>{visible ? 'Hide passwords' : 'Show passwords'}</Text></Pressable>
        </>}
        {!!message && <Text accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[styles.notice,{color:error ? Colors.error : Colors.text}]}>{message}</Text>}
        {stage !== 'done' && <Pressable accessibilityRole="button" accessibilityState={{disabled:busy,busy}} aria-busy={busy} disabled={busy} onPress={() => void (stage === 'email' ? send() : finish())} style={[styles.primary,busy && {opacity:0.7}]}>
          {busy ? <ActivityIndicator color={Colors.textOnAccent} accessibilityLabel={stage === 'email' ? 'Requesting email code' : 'Changing password'} /> : <Text style={styles.primaryText}>{stage === 'email' ? 'Send recovery code' : 'Save new password'}</Text>}
        </Pressable>}
        {stage === 'code' && <View style={styles.row}>
          <Pressable accessibilityRole="button" disabled={busy || remaining > 0} onPress={() => void send()} style={styles.secondary}><Text style={{color:busy || remaining > 0 ? Colors.textSecondary : Colors.accent}}>{remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={restart} style={styles.secondary}><Text style={styles.linkText}>Use another email</Text></Pressable>
        </View>}
        {stage === 'done' && <Link href="/" style={[styles.link,{textAlign:'center'}]}>Return to TrackBing</Link>}
        <LegalLinks />
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:Colors.primary},container:{flexGrow:1,justifyContent:'center',alignItems:'center',padding:20,paddingBottom:40},
  card:{width:'100%',maxWidth:480,gap:12,padding:20,backgroundColor:Colors.surface,borderRadius:Radii.card,borderWidth:1,borderColor:Colors.border},
  title:{fontSize:26,fontWeight:'700',color:Colors.text},copy:{color:Colors.textSecondary,fontSize:14,lineHeight:21},label:{color:Colors.text,fontSize:14,fontWeight:'600',marginTop:6},
  input:{minHeight:48,borderWidth:1,borderColor:Colors.controlBorder,borderRadius:Radii.inner,padding:12,color:Colors.text,backgroundColor:Colors.inputBg,fontSize:16},
  primary:{minHeight:48,backgroundColor:Colors.accent,borderRadius:Radii.inner,justifyContent:'center',alignItems:'center',padding:12},primaryText:{color:Colors.textOnAccent,fontWeight:'700',fontSize:16},
  secondary:{minHeight:44,padding:10,justifyContent:'center'},link:{color:Colors.accent,paddingVertical:12,minHeight:44},linkText:{color:Colors.accent},row:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between'},notice:{fontSize:14,lineHeight:22},
});
