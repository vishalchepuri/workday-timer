import { supabase } from "./supabaseClient.js";

function throwIfError(error) {
  if (error) throw error;
}

function toAppSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    startTime: row.start_time,
    endTime: row.end_time,
    note: row.note || "",
  };
}

function toSessionRow(userId, session) {
  return {
    id: session.id,
    user_id: userId,
    start_time: session.startTime,
    end_time: session.endTime || null,
    note: session.note || "",
    updated_at: new Date().toISOString(),
  };
}

function toAppProfile(row) {
  return {
    id: row.user_id,
    name: row.name || row.email || "User",
    email: row.email || "",
  };
}

function toAppSettings(settingsRow, holidayRows) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  return {
    dailyTargetHours: Number(settingsRow?.daily_target_hours ?? 6.5),
    trackingStartMonth: settingsRow?.tracking_start_month || currentMonth,
    targetVersion: Number(settingsRow?.target_version ?? 2),
    holidays: holidayRows.map((holiday) => ({
      date: holiday.holiday_date,
      reason: holiday.reason || "",
    })),
  };
}

export async function upsertRemoteProfile(authUser, fallbackName = "User") {
  if (!supabase || !authUser?.id) return;
  const email = authUser.email || "";
  const name = authUser.user_metadata?.name || fallbackName || email.split("@")[0] || "User";
  const { error } = await supabase.from("hourlog_profiles").upsert(
    {
      user_id: authUser.id,
      email,
      name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  throwIfError(error);
}

export async function fetchHourLogData(userId) {
  if (!supabase) return null;

  const [sessionsResult, settingsResult, holidaysResult] = await Promise.all([
    supabase.from("hourlog_sessions").select("id,user_id,start_time,end_time,note").eq("user_id", userId).order("start_time"),
    supabase
      .from("hourlog_settings")
      .select("daily_target_hours,tracking_start_month,target_version")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("hourlog_holidays").select("holiday_date,reason").eq("user_id", userId).order("holiday_date"),
  ]);

  throwIfError(sessionsResult.error);
  throwIfError(settingsResult.error);
  throwIfError(holidaysResult.error);

  return {
    sessions: (sessionsResult.data || []).map(toAppSession),
    settings: toAppSettings(settingsResult.data, holidaysResult.data || []),
    hasSettings: Boolean(settingsResult.data),
  };
}

export async function upsertRemoteSettings(userId, settings) {
  if (!supabase) return;
  const { error } = await supabase.from("hourlog_settings").upsert(
    {
      user_id: userId,
      daily_target_hours: settings.dailyTargetHours,
      tracking_start_month: settings.trackingStartMonth,
      target_version: 2,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  throwIfError(error);
}

export async function upsertRemoteSession(userId, session) {
  if (!supabase) return;
  const { error } = await supabase.from("hourlog_sessions").upsert(toSessionRow(userId, session), { onConflict: "id" });
  throwIfError(error);
}

export async function upsertRemoteHoliday(userId, holiday) {
  if (!supabase) return;
  const { error } = await supabase.from("hourlog_holidays").upsert(
    {
      user_id: userId,
      holiday_date: holiday.date,
      reason: holiday.reason || "",
    },
    { onConflict: "user_id,holiday_date" }
  );
  throwIfError(error);
}

export async function deleteRemoteHoliday(userId, holidayDate) {
  if (!supabase) return;
  const { error } = await supabase.from("hourlog_holidays").delete().eq("user_id", userId).eq("holiday_date", holidayDate);
  throwIfError(error);
}

export async function fetchAdminHourLogData() {
  if (!supabase) return null;

  const [profilesResult, sessionsResult, settingsResult, holidaysResult] = await Promise.all([
    supabase.from("hourlog_profiles").select("user_id,email,name").order("name"),
    supabase.from("hourlog_sessions").select("id,user_id,start_time,end_time,note").order("start_time", { ascending: false }),
    supabase.from("hourlog_settings").select("user_id,daily_target_hours,tracking_start_month,target_version"),
    supabase.from("hourlog_holidays").select("user_id,holiday_date,reason").order("holiday_date", { ascending: false }),
  ]);

  throwIfError(profilesResult.error);
  throwIfError(sessionsResult.error);
  throwIfError(settingsResult.error);
  throwIfError(holidaysResult.error);

  const holidaysByUser = new Map();
  (holidaysResult.data || []).forEach((holiday) => {
    const current = holidaysByUser.get(holiday.user_id) || [];
    current.push(holiday);
    holidaysByUser.set(holiday.user_id, current);
  });

  return {
    profiles: (profilesResult.data || []).map(toAppProfile),
    sessions: (sessionsResult.data || []).map(toAppSession),
    settings: (settingsResult.data || []).map((setting) => ({
      userId: setting.user_id,
      ...toAppSettings(setting, holidaysByUser.get(setting.user_id) || []),
    })),
  };
}
