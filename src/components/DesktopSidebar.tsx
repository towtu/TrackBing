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
} from "phosphor-react-native";
import { Colors, Radii } from "../styles/colors";
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

      {/* Streak */}
      {streak > 0 && (
        <Text style={styles.streakLine}>
          <Text style={styles.streakCount}>{streak}-day</Text> streak
        </Text>
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
                <Icon
                  size={18}
                  weight={item.isActive ? "fill" : "regular"}
                  color={item.isActive ? Colors.accent : Colors.textSecondary}
                />
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
          <SignOut size={18} weight="regular" color={Colors.textSecondary} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 240,
    backgroundColor: Colors.primary,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
    paddingTop: 32,
    paddingBottom: 18,
    paddingHorizontal: 16,
    height: "100%",
    minHeight: 0,
  },
  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 10,
    flexShrink: 0,
  },
  logoBadge: {
    width: 34,
    height: 34,
    borderRadius: Radii.inner,
    backgroundColor: Colors.accentDim,
    alignItems: "center",
    justifyContent: "center",
  },
  logoImage: {
    width: 24,
    height: 24,
  },
  brandName: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  streakLine: {
    color: Colors.textSecondary,
    fontSize: 13,
    paddingHorizontal: 12,
    marginBottom: 16,
    flexShrink: 0,
  },
  streakCount: {
    color: Colors.accent,
    fontWeight: "600",
  },
  navContainer: {
    flex: 1,
    minHeight: 0,
    marginBottom: 12,
  },
  navScroll: {
    flex: 1,
    minHeight: 0,
  },
  navContent: {
    gap: 6,
    paddingVertical: 4,
    paddingBottom: 8,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Radii.inner,
    gap: 11,
  },
  navItemHover: {
    backgroundColor: Colors.surfaceHover,
  },
  navItemActive: {
    backgroundColor: Colors.accentDim,
  },
  navLabel: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
  },
  navLabelActive: {
    color: Colors.accent,
    fontWeight: "600",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
    gap: 10,
    flexShrink: 0,
  },
  profileSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    color: Colors.accent,
    fontWeight: "600",
    fontSize: 15,
  },
  profileDetails: {
    flex: 1,
    overflow: "hidden",
  },
  profileEmail: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  profileSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: "500",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Radii.inner,
    gap: 10,
    minHeight: 40,
  },
  logoutBtnHover: {
    backgroundColor: Colors.surfaceHover,
  },
  logoutText: {
    color: Colors.textSecondary,
    fontSize: 13.5,
    fontWeight: "500",
  },
});
