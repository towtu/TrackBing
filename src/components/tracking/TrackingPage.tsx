import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Radii } from '@/src/styles/colors';

export function TrackingPage({title,description,children}:{title:string;description:string;children:ReactNode}) {
  return <KeyboardAvoidingView style={trackingStyles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={trackingStyles.container}>
      <View style={trackingStyles.content}>
        <Link href="/" style={trackingStyles.link}>Back to dashboard</Link>
        <Text accessibilityRole="header" style={trackingStyles.title}>{title}</Text>
        <Text style={trackingStyles.copy}>{description}</Text>
        {children}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
export function TrackingAction({label,onPress,disabled=false,primary=false,busy=false}:{label:string;onPress:()=>void;disabled?:boolean;primary?:boolean;busy?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled,busy}} aria-busy={busy} disabled={disabled} onPress={onPress} style={[trackingStyles.action,primary && trackingStyles.primary,disabled && {opacity:0.65}]}>
    {busy ? <ActivityIndicator color={primary ? Colors.textOnAccent : Colors.accent} accessibilityLabel={label} /> : <Text style={{color:primary ? Colors.textOnAccent : Colors.accent,fontWeight:'600'}}>{label}</Text>}
  </Pressable>;
}
export const trackingStyles = StyleSheet.create({
  root:{flex:1,backgroundColor:Colors.primary},container:{alignItems:'center',padding:20,paddingBottom:120},content:{width:'100%',maxWidth:820,gap:16},
  title:{color:Colors.text,fontSize:28,fontWeight:'700'},copy:{color:Colors.textSecondary,fontSize:14,lineHeight:22},text:{color:Colors.text,fontSize:16,lineHeight:24},
  link:{color:Colors.accent,minHeight:44,paddingVertical:12},label:{color:Colors.text,fontSize:14,fontWeight:'600'},
  row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12},field:{gap:8,flexGrow:1,minWidth:140},
  input:{minHeight:48,padding:12,color:Colors.text,backgroundColor:Colors.inputBg,borderWidth:1,borderColor:Colors.controlBorder,borderRadius:Radii.inner,fontSize:16},
  action:{minHeight:48,paddingHorizontal:16,paddingVertical:12,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:Colors.controlBorder,borderRadius:Radii.inner},primary:{backgroundColor:Colors.accent,borderColor:Colors.accent},
  section:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:Radii.card,padding:16,gap:12},error:{color:Colors.error,fontSize:14,lineHeight:22},
});
