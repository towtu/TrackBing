import React, { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { usePathname, useRouter } from "expo-router";
import {
  House,
  MagnifyingGlass,
  BookOpen,
  ForkKnife,
  ChartBar,
  User,
  Barcode,
  SignOut,
  Fire,
} from "phosphor-react-native";
import { Colors } from "../styles/colors";
import { supabase } from "../lib/supabase";

export default function DesktopSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState("");
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let active = true;
    async function fetchUserData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      setEmail(user.email || "");

      // Fetch streak
      const { data: summaries } = await supabase
        .from("daily_summaries")
        .select("date")
        .eq("user_id", user.id)
        .gt("meal_count", 0)
        .order("date", { ascending: false });

      if (!summaries || summaries.length === 0) return;

      const dates = new Set<string>(summaries.map(s => s.date));
      const todayStr = new Date().toISOString().split("T")[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      if (!dates.has(todayStr) && !dates.has(yesterdayStr)) {
        if (active) setStreak(0);
        return;
      }

      let count = 0;
      const checkDate = new Date(dates.has(todayStr) ? todayStr : yesterdayStr);
      const sorted = Array.from(dates).sort().reverse();

      for (let i = 0; i < sorted.length; i++) {
        const expected = new Date(checkDate);
        expected.setDate(expected.getDate() - i);
        const expectedStr = expected.toISOString().split("T")[0];
        if (sorted.includes(expectedStr)) {
          count++;
        } else {
          break;
        }
      }
      if (active) setStreak(count);
    }

    fetchUserData();
    return () => { active = false; };
  }, [pathname]); // Refresh on route changes

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const navItems = [
    {
      label: "Dashboard",
      icon: House,
      route: "/",
      isActive: pathname === "/" || pathname === "/index" || pathname.includes("/(tabs)/index") || (!pathname.includes("/add") && !pathname.includes("/cookbook") && !pathname.includes("/my-foods") && !pathname.includes("/create") && !pathname.includes("/stats") && !pathname.includes("/profile") && !pathname.includes("/scan")),
    },
    {
      label: "Find Food",
      icon: MagnifyingGlass,
      route: "/(tabs)/add",
      isActive: pathname.includes("/add"),
    },
    {
      label: "My Cookbook",
      icon: BookOpen,
      route: "/(tabs)/cookbook",
      isActive: pathname.includes("/cookbook"),
    },
    {
      label: "My Foods",
      icon: ForkKnife,
      route: "/my-foods",
      isActive: pathname.includes("/my-foods"),
    },
    {
      label: "Weekly Stats",
      icon: ChartBar,
      route: "/(tabs)/stats",
      isActive: pathname.includes("/stats"),
    },
    {
      label: "Profile",
      icon: User,
      route: "/(tabs)/profile",
      isActive: pathname.includes("/profile"),
    },
    {
      label: "Scan Barcode",
      icon: Barcode,
      route: "/scan",
      isActive: pathname.includes("/scan"),
    },
  ];

  return (
    <View style={styles.sidebar}>
      {/* Brand Header */}
      <View style={styles.brandContainer}>
        <View style={styles.logoBadge}>
          <Image
            source={require("../../assets/images/TrackBingIcon.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.brandName}>TrackBing</Text>
      </View>

      {/* Streak Panel */}
      {streak > 0 && (
        <View style={styles.streakPanel}>
          <Fire size={18} weight="fill" color="#FF6B35" />
          <Text style={styles.streakText}>
            <Text style={styles.streakCount}>{streak}</Text> Day Streak!
          </Text>
        </View>
      )}

      {/* Navigation items */}
      <View style={styles.navContainer}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.navScroll}
          contentContainerStyle={styles.navContent}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Pressable
                key={item.label}
                onPress={() => router.push(item.route as any)}
                style={({ hovered }: any) => [
                  styles.navItem,
                  item.isActive && styles.navItemActive,
                  hovered && !item.isActive && styles.navItemHover,
                ]}
              >
                <View style={[styles.iconContainer, item.isActive && styles.iconActive]}>
                  <Icon
                    size={20}
                    weight={item.isActive ? "fill" : "bold"}
                    color={item.isActive ? Colors.accent : Colors.textSecondary}
                  />
                </View>
                <Text style={[styles.navLabel, item.isActive && styles.navLabelActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* User profile footer */}
      <View style={styles.footer}>
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>
              {email ? email.charAt(0).toUpperCase() : "U"}
            </Text>
          </View>
          <View style={styles.profileDetails}>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {email || "User"}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={handleLogout}
          style={({ hovered }: any) => [
            styles.logoutBtn,
            hovered && styles.logoutBtnHover,
          ]}
        >
          <SignOut size={18} weight="bold" color={Colors.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 260,
    backgroundColor: Colors.secondary,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    paddingTop: 40,
    paddingBottom: 24,
    paddingHorizontal: 20,
    height: "100%",
    minHeight: 0,
  },
  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    gap: 12,
    flexShrink: 0,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.accentDim,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logoImage: {
    width: 28,
    height: 28,
  },
  brandName: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  streakPanel: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 107, 53, 0.08)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 107, 53, 0.15)",
    marginBottom: 24,
    gap: 8,
    flexShrink: 0,
  },
  streakText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  streakCount: {
    color: "#FF6B35",
    fontWeight: "900",
  },
  navContainer: {
    flex: 1,
    minHeight: 0,
    marginBottom: 16,
  },
  navScroll: {
    flex: 1,
    minHeight: 0,
  },
  navContent: {
    gap: 8,
    paddingVertical: 4,
    paddingBottom: 8,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    gap: 12,
  },
  navItemHover: {
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  navItemActive: {
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.15)",
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: {
    backgroundColor: "rgba(255, 204, 0, 0.08)",
  },
  navLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  navLabelActive: {
    color: Colors.accent,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 16,
    gap: 12,
    flexShrink: 0,
  },
  profileSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    color: Colors.primary,
    fontWeight: "900",
    fontSize: 16,
  },
  profileDetails: {
    flex: 1,
    overflow: "hidden",
  },
  profileEmail: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  profileSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    gap: 12,
    backgroundColor: "rgba(239, 68, 68, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.1)",
    minHeight: 46,
  },
  logoutBtnHover: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  logoutText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: "800",
  },
});
