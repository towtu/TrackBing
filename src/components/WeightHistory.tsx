import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getAccountDay } from "@/src/lib/accountDay";
import { supabase } from "@/src/lib/supabase";
import { createBeeRequestId, resolveBeeTimeZone } from "@/src/lib/beeChat";
import {
  emitFoodLogChanged,
  subscribeFoodLogChanged,
} from "@/src/lib/foodLogEvents";
import { BeeAction } from "@/src/components/ai/BeeMemories";
import { Colors, Radii } from "@/src/styles/colors";
import { dayBounds, localDay } from "../../supabase/functions/_shared/beeDates";
import { lbToKg, STAT_LIMITS } from "@/src/lib/nutritionTargets";
type WeightRow = {
  id: string;
  weight_kg: number;
  original_amount: number;
  unit: "kg" | "lb";
  local_date: string | null;
  is_baseline: boolean;
};
type Review = {
  id: string | null;
  amount: number | null;
  unit: "kg" | "lb";
  day: string;
  remove: boolean;
  requestId: string;
  measuredAt: string | null;
  timezone: string;
};
export function WeightHistory() {
  const [rows, setRows] = useState<WeightRow[]>([]),
    [amount, setAmount] = useState(""),
    [unit, setUnit] = useState<"kg" | "lb">("kg"),
    [day, setDay] = useState(() => localDay(new Date(), resolveBeeTimeZone())),
    [timeZone, setTimeZone] = useState(resolveBeeTimeZone),
    [editId, setEditId] = useState<string | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const owner = useRef<string | null>(null), generation = useRef(0), initializedDate = useRef(false);
  const load = useCallback(async () => {
    const turn = ++generation.current;
    const { data: { user } } = await supabase.auth.getUser();
    owner.current = user?.id ?? null;
    if (!user) {
      setRows([]);
      return;
    }
    let account: Awaited<ReturnType<typeof getAccountDay>>;
    try { account = await getAccountDay(user.id); } catch {
      if (turn === generation.current) setError("Your account date is unavailable. Refresh before reviewing a weight.");
      return;
    }
    if (turn !== generation.current) return;
    setTimeZone(account.timeZone);
    if (!initializedDate.current) { setDay(account.date); initializedDate.current = true; }
    const { data, error } = await supabase.from("weight_logs").select(
      "id,weight_kg,original_amount,unit,local_date,is_baseline",
    ).eq("user_id", user.id).order("measured_at", {
      ascending: false,
      nullsFirst: false,
    }).limit(30);
    if (turn !== generation.current) return;
    if (error) {
      setError(
        "Weight history is unavailable. Refresh after the new service is installed.",
      );
    } else {
      setRows(data ?? []);
      setError("");
    }
  }, []);
  useEffect(() => {
    void load();
    const off = subscribeFoodLogChanged(() => void load());
    const { data } = supabase.auth.onAuthStateChange(() => {
      generation.current++;
      owner.current = null;
      initializedDate.current = false;
      setRows([]);
      setReview(null);
      setAmount("");
      void load();
    });
    return () => {
      // This is a request epoch, not a DOM ref; advance it to reject late responses.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      off();
      data.subscription.unsubscribe();
    };
  }, [load]);
  const propose = () => {
    const value = /^\d+(?:\.\d+)?$/.test(amount.trim()) ? Number(amount) : NaN;
    const kg = unit === "lb" ? lbToKg(value) : value;
    try {
      dayBounds(day, timeZone);
      if (day > localDay(new Date(), timeZone)) {
        throw new Error("date");
      }
    } catch {
      setError(
        "Choose a valid measurement date, today or earlier (YYYY-MM-DD).",
      );
      return;
    }
    if (
      !Number.isFinite(kg) || kg < STAT_LIMITS.weightKg.min ||
      kg > STAT_LIMITS.weightKg.max
    ) {
      setError(
        "Enter a weight between 30 and 300 kg, or its lb equivalent. Other values need support; they are never clamped.",
      );
      return;
    }
    setError("");
    setReview({
      id: editId,
      amount: value,
      unit,
      day,
      remove: false,
      requestId: createBeeRequestId(),
      timezone: timeZone,
      measuredAt: day === localDay(new Date(), timeZone) ? new Date().toISOString() : new Date(Date.parse(dayBounds(day, timeZone).start) + 12 * 3600000).toISOString(),
    });
  };
  const save = async () => {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    const expected = owner.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!expected || session?.user.id !== expected) {
        throw new Error("account");
      }
      const timezone = review.timezone;
      const measuredAt = review.measuredAt; // Keep the reviewed snapshot stable on response-loss retries.
      const { data, error } = await supabase.rpc("save_weight_checkin", {
        p_request: review.requestId,
        p_amount: review.remove ? null : review.amount,
        p_unit: review.unit,
        p_measured_at: measuredAt,
        p_timezone: timezone,
        p_id: review.id,
        p_delete: review.remove,
      });
      const current = await supabase.auth.getSession();
      if (current.data.session?.user.id !== expected) return;
      if (error || !data?.ok) throw new Error("save");
      setReview(null);
      setEditId(null);
      setAmount("");
      emitFoodLogChanged();
      await load();
    } catch {
      setError(
        "Weight was not confirmed saved. Retry this same review safely, or cancel and refresh.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Weight history
      </Text>
      <Text style={styles.copy}>
        Dated check-ins update your current weight only when they are the latest
        measurement. Nutrition targets stay unchanged.
      </Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Check-in weight"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={(value) => {
            setAmount(value);
            setReview(null);
          }}
          maxLength={12}
          placeholder="Weight"
          placeholderTextColor={Colors.textSecondary}
          style={styles.input}
        />
        <BeeAction
          label={unit === "kg" ? "kg (change to lb)" : "lb (change to kg)"}
          disabled={busy}
          onPress={() => {
            setUnit(unit === "kg" ? "lb" : "kg");
            setReview(null);
          }}
        />
      </View>
      <TextInput
        accessibilityLabel="Measurement date, YYYY-MM-DD"
        value={day}
        onChangeText={(value) => {
          setDay(value);
          setReview(null);
        }}
        maxLength={10}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={Colors.textSecondary}
        style={styles.input}
      />
      <BeeAction
        label={editId ? "Review correction" : "Review check-in"}
        disabled={busy}
        onPress={propose}
      />
      {review
        ? (
          <View style={styles.review}>
            <Text style={styles.copy}>
              {review.remove
                ? "Delete this check-in and recalculate current weight?"
                : `Save ${review.amount} ${review.unit} for ${review.day}?`}
            </Text>
            <View style={styles.row}>
              <BeeAction
                label="Confirm"
                primary
                disabled={busy}
                onPress={() => void save()}
              />
              <BeeAction
                label="Cancel"
                disabled={busy}
                onPress={() => setReview(null)}
              />
            </View>
          </View>
        )
        : null}
      {busy ? <ActivityIndicator color={Colors.accent} /> : null}
      {error
        ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        : null}
      <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
        {rows.length === 0
          ? <Text style={styles.copy}>No recorded weigh-ins yet.</Text>
          : rows.map((row) => (
            <View key={row.id} style={styles.entry}>
              <Text style={styles.copy}>
                {row.original_amount} {row.unit} · {row.is_baseline
                  ? "Profile baseline (measurement date unknown)"
                  : row.local_date}
              </Text>
              <View style={styles.row}>
                <BeeAction
                  label="Edit"
                  disabled={busy || row.is_baseline}
                  accessibilityLabel={`Edit weight ${row.original_amount} ${row.unit}`}
                  onPress={() => {
                    setEditId(row.id);
                    setAmount(String(row.original_amount));
                    setUnit(row.unit);
                    setDay(
                      row.local_date ??
                        localDay(new Date(), timeZone),
                    );
                    setReview(null);
                  }}
                />
                <BeeAction
                  label="Delete"
                  disabled={busy || row.is_baseline}
                  accessibilityLabel={`Delete weight ${row.original_amount} ${row.unit}`}
                  onPress={() =>
                    setReview({
                      id: row.id,
                      amount: null,
                      unit: row.unit,
                      day: row.local_date ?? "",
                      remove: true,
                      requestId: createBeeRequestId(),
                      measuredAt: null,
                      timezone: timeZone,
                    })}
                />
              </View>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.card,
    padding: 18,
    gap: 12,
    marginVertical: 14,
  },
  title: { color: Colors.text, fontSize: 20, fontWeight: "600" },
  copy: { color: Colors.textSecondary, fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  input: {
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.controlBorder,
    borderRadius: 10,
    minHeight: 44,
    padding: 10,
    minWidth: 120,
    flexGrow: 1,
  },
  review: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  entry: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  error: { color: Colors.error },
});
