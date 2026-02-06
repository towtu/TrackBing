import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";

// You get these from your Supabase Dashboard -> Project Settings -> API
const supabaseUrl = "https://dnplpaoxgpajbbunscdg.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRucGxwYW94Z3BhamJidW5zY2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NDM1NDQsImV4cCI6MjA4NTUxOTU0NH0.JCer7bZf8x5mb4COVaOPJm997EwtmfXORoqgDlsDZTM";

// Custom storage adapter to handle Web (SSR) vs Mobile
const ExpoStorage = {
  getItem: (key: string) => {
    if (Platform.OS === "web") {
      if (typeof localStorage === "undefined") {
        return null;
      }
      return localStorage.getItem(key);
    }
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      }
    } else {
      AsyncStorage.setItem(key, value);
    }
  },
  removeItem: (key: string) => {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(key);
      }
    } else {
      AsyncStorage.removeItem(key);
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoStorage, // Use our custom adapter
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
