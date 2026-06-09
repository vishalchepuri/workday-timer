import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Download,
  ListChecks,
  LogIn,
  LogOut,
  Pencil,
  Save,
  ShieldCheck,
  Timer,
  TrendingUp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearCurrentUserId,
  createId,
  readCurrentUserId,
  readDatabase,
  writeCurrentUserId,
  writeDatabase,
} from "./lib/localDatabase.js";
import {
  deleteRemoteHoliday,
  fetchHourLogData,
  upsertRemoteHoliday,
  upsertRemoteSession,
  upsertRemoteSettings,
} from "./lib/supabaseData.js";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient.js";

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatBalance(milliseconds) {
  if (Math.abs(milliseconds) < 60000) return "On target";
  return `${milliseconds >= 0 ? "+" : "-"}${formatDuration(Math.abs(milliseconds))}`;
}

function formatClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date) {
  return dayKey(date).slice(0, 7);
}

function monthStartFromKey(value) {
  return new Date(`${value || monthKey(new Date())}-01T00:00:00`);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(date) {
  const copy = startOfDay(date);
  const diff = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateTimeLocalValue(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  return new Date(value).toISOString();
}

function sessionDuration(session, liveNow = new Date()) {
  const end = session.endTime ? new Date(session.endTime) : liveNow;
  return end.getTime() - new Date(session.startTime).getTime();
}

function getUserSettings(data, userId) {
  const saved = data.settings?.[userId];
  const currentMonth = monthKey(new Date());
  const normalizeHolidays = (holidays = []) =>
    holidays
      .map((holiday) =>
        typeof holiday === "string"
          ? { date: holiday, reason: "" }
          : { date: holiday.date, reason: holiday.reason || "" }
      )
      .filter((holiday) => holiday.date);
  if (saved?.targetVersion === 2) {
    return {
      dailyTargetHours: 6.5,
      trackingStartMonth: currentMonth,
      ...saved,
      holidays: normalizeHolidays(saved.holidays),
    };
  }
  return {
    dailyTargetHours: 6.5,
    targetVersion: 2,
    holidays: normalizeHolidays(saved?.holidays),
    trackingStartMonth: saved?.trackingStartMonth || currentMonth,
  };
}

function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function targetStartDate(settings) {
  return startOfMonth(monthStartFromKey(settings.trackingStartMonth));
}

function clampTargetStart(start, settings) {
  const trackingStart = targetStartDate(settings);
  return startOfDay(start) < trackingStart ? trackingStart : startOfDay(start);
}

function workdayKeysBetween(start, end, settings) {
  const holidays = settings?.holidays || [];
  const holidaySet = new Set(holidays.map((holiday) => holiday.date));
  const keys = [];
  let cursor = settings ? clampTargetStart(start, settings) : startOfDay(start);
  const finalDay = startOfDay(end);
  if (cursor > finalDay) return keys;
  while (cursor <= finalDay) {
    const key = dayKey(cursor);
    if (isWeekday(cursor) && !holidaySet.has(key)) keys.push(key);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

function targetMillisecondsForRange(start, end, settings) {
  return workdayKeysBetween(start, end, settings).length * settings.dailyTargetHours * 60 * 60 * 1000;
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportSessionsCsv(sessions) {
  const rows = [
    ["Date", "Login", "Logout", "Duration", "Note"],
    ...sessions.map((session) => {
      const start = new Date(session.startTime);
      const end = new Date(session.endTime);
      return [formatDate(start), formatTime(start), formatTime(end), formatDuration(sessionDuration(session)), session.note || ""];
    }),
  ];
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `hourlog-${dayKey(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function totalDuration(sessions, liveNow) {
  return sessions.reduce((total, session) => total + sessionDuration(session, liveNow), 0);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function sessionsBetween(sessions, start, end) {
  return sessions.filter((session) => {
    const startTime = new Date(session.startTime);
    return session.endTime && startTime >= start && startTime <= end;
  });
}

function rangeDates(range, customStart, customEnd, selectedMonth = monthKey(new Date())) {
  const current = new Date();
  if (range === "weekly") return [startOfWeek(current), current];
  if (range === "monthly") {
    const selected = monthStartFromKey(selectedMonth);
    return [startOfMonth(selected), endOfMonth(selected)];
  }
  if (range === "last3") {
    const start = startOfDay(current);
    start.setMonth(start.getMonth() - 3);
    return [start, current];
  }
  if (range === "custom") {
    const start = customStart ? new Date(`${customStart}T00:00:00`) : startOfDay(current);
    const end = customEnd ? new Date(`${customEnd}T23:59:59`) : current;
    return [start, end];
  }
  return [startOfDay(current), current];
}

function groupSessionsByDay(sessions) {
  const groups = new Map();
  sessions.forEach((session) => {
    const start = new Date(session.startTime);
    const key = dayKey(start);
    if (!groups.has(key)) {
      groups.set(key, { date: start, sessions: [], total: 0 });
    }
    const group = groups.get(key);
    group.sessions.push(session);
    group.total += sessionDuration(session);
  });
  return [...groups.values()]
    .map((group) => {
      const sortedSessions = [...group.sessions].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      const breakTotal = sortedSessions.reduce((total, session, index) => {
        if (index === 0) return total;
        const previousEnd = new Date(sortedSessions[index - 1].endTime);
        const currentStart = new Date(session.startTime);
        return total + Math.max(0, currentStart.getTime() - previousEnd.getTime());
      }, 0);
      return {
        ...group,
        sessions: sortedSessions,
        breakTotal,
        breakCount: Math.max(0, sortedSessions.length - 1),
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function currentWorkStreak(sessions, settings, today = new Date()) {
  const loggedDays = new Set(sessions.map((session) => dayKey(new Date(session.startTime))));
  const holidaySet = new Set((settings.holidays || []).map((holiday) => holiday.date));
  let cursor = startOfDay(today);
  let count = 0;
  for (let index = 0; index < 90; index += 1) {
    const key = dayKey(cursor);
    if (!isWeekday(cursor) || holidaySet.has(key)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!loggedDays.has(key)) break;
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

function makeBuckets(range, sessions, start, end) {
  if (range === "daily" || range === "custom") {
    const buckets = new Map();
    let cursor = startOfDay(start);
    while (cursor <= end) {
      buckets.set(dayKey(cursor), {
        label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(cursor),
        total: 0,
      });
      cursor = addDays(cursor, 1);
      if (buckets.size > 45) break;
    }
    sessions.forEach((session) => {
      const key = dayKey(new Date(session.startTime));
      if (buckets.has(key)) buckets.get(key).total += sessionDuration(session);
    });
    return [...buckets.values()];
  }

  if (range === "weekly") {
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return {
        key: dayKey(date),
        label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
        total: 0,
      };
    });
    sessions.forEach((session) => {
      const bucket = buckets.find((item) => item.key === dayKey(new Date(session.startTime)));
      if (bucket) bucket.total += sessionDuration(session);
    });
    return buckets;
  }

  const monthBuckets = new Map();
  sessions.forEach((session) => {
    const date = new Date(session.startTime);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const label = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
    monthBuckets.set(key, monthBuckets.get(key) || { label, total: 0 });
    monthBuckets.get(key).total += sessionDuration(session);
  });
  return [...monthBuckets.values()].reverse();
}

function buildMonthCalendar(date, sessions, settings) {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const firstCalendarDay = startOfDay(monthStart);
  firstCalendarDay.setDate(firstCalendarDay.getDate() - firstCalendarDay.getDay());
  const lastCalendarDay = startOfDay(monthEnd);
  lastCalendarDay.setDate(lastCalendarDay.getDate() + (6 - lastCalendarDay.getDay()));
  const holidayMap = new Map(settings.holidays.map((holiday) => [holiday.date, holiday]));
  const dayTotals = new Map();

  sessionsBetween(sessions, monthStart, monthEnd).forEach((session) => {
    const key = dayKey(new Date(session.startTime));
    dayTotals.set(key, (dayTotals.get(key) || 0) + sessionDuration(session));
  });

  const days = [];
  let cursor = firstCalendarDay;
  while (cursor <= lastCalendarDay) {
    const key = dayKey(cursor);
    const inMonth = cursor.getMonth() === monthStart.getMonth();
    const holiday = holidayMap.get(key);
    const weekday = isWeekday(cursor);
    const target = inMonth && weekday && !holiday ? targetMillisecondsForRange(cursor, cursor, settings) : 0;
    const logged = dayTotals.get(key) || 0;
    const balance = logged - target;
    const status = !inMonth
      ? "outside"
      : holiday
        ? "holiday"
        : !weekday
          ? logged > 0 ? "logged-offday" : "weekend"
          : target === 0
            ? logged > 0 ? "logged-offday" : "not-tracked"
          : logged === 0
            ? "empty"
            : Math.abs(balance) < 60000
              ? "on-target"
              : balance > 0
                ? "over"
                : "short";
    days.push({
      key,
      date: new Date(cursor),
      inMonth,
      holiday,
      holidayReason: holiday?.reason || "",
      weekday,
      logged,
      target,
      balance,
      status,
    });
    cursor = addDays(cursor, 1);
  }
  return days;
}

function HomeScreen({ onGetStarted, onSignIn }) {
  const workflowSteps = [
    ["Clock in", "Start a session when work begins, then pause naturally for lunch or breaks."],
    ["Clock out", "End each session separately so split days stay accurate."],
    ["Review", "See daily, weekly, monthly, last 3 months, and custom reports."],
  ];
  const reportCards = [
    ["Daily", "Today balance", "+0h 15m"],
    ["Weekly", "Workdays", "5 days"],
    ["Monthly", "Target left", "42h 10m"],
  ];

  return (
    <main className="home-screen" aria-labelledby="home-title">
      <section className="home-copy">
        <div className="brand-line">
          <div className="brand-mark compact" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">Office time tracker</p>
        </div>
        <h1 id="home-title">Track office hours without guesswork.</h1>
        <p className="home-description">
          HourLog records every login and logout session, adds repeated breaks correctly, and turns your daily work into
          clean weekly, monthly, last 3 months, and custom reports.
        </p>
        <div className="home-feature-grid" aria-label="Application features">
          <div>
            <Timer aria-hidden="true" size={20} />
            <span>Multiple work sessions per day</span>
          </div>
          <div>
            <CalendarDays aria-hidden="true" size={20} />
            <span>Month targets with holidays removed</span>
          </div>
          <div>
            <ShieldCheck aria-hidden="true" size={20} />
            <span>Secure cloud sync</span>
          </div>
        </div>
        <div className="home-workflow" aria-label="How HourLog works">
          {workflowSteps.map(([title, description], index) => (
            <article style={{ "--step-index": index }} key={title}>
              <strong>{title}</strong>
              <span>{description}</span>
            </article>
          ))}
        </div>
      </section>

      <aside className="home-action-panel" aria-label="Start using HourLog">
        <div className="home-preview">
          <div>
            <span>Today</span>
            <strong>06h 30m</strong>
          </div>
          <div>
            <span>Breaks</span>
            <strong>2 sessions</strong>
          </div>
          <div>
            <span>Monthly target</span>
            <strong>136h 30m</strong>
          </div>
        </div>
        <div className="home-mini-chart" aria-label="Sample weekly progress">
          {[62, 88, 54, 96, 76, 42, 70].map((height, index) => (
            <span style={{ "--bar-height": `${height}%`, "--bar-index": index }} key={index} />
          ))}
        </div>
        <div className="home-report-strip" aria-label="Available report examples">
          {reportCards.map(([range, label, value]) => (
            <div key={range}>
              <span>{range}</span>
              <strong>{value}</strong>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <button className="primary-action" type="button" onClick={onGetStarted}>
          <span>Get started</span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        <button className="secondary-action" type="button" onClick={onSignIn}>
          <LogIn aria-hidden="true" size={18} />
          <span>Sign in</span>
        </button>
      </aside>
    </main>
  );
}

function AuthScreen({ onSignIn, onSignUp, cloudAuthEnabled, initialMode = "signin", onNavigateHome, onNavigateAuth }) {
  const [mode, setMode] = useState(initialMode);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setMessage("");
  }, [initialMode]);

  async function handleSignIn(event) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const error = await onSignIn(String(form.get("email")), String(form.get("password")));
    setMessage(error || "");
    setPending(false);
  }

  async function handleSignUp(event) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const error = await onSignUp(String(form.get("name")), String(form.get("email")), String(form.get("password")));
    setMessage(error || "");
    setPending(false);
  }

  return (
    <section className="auth-screen" aria-labelledby="auth-title">
      <button className="back-home" type="button" onClick={onNavigateHome}>
        HourLog
      </button>
      <div className="auth-panel">
        <div className="auth-heading">
          <p className="eyebrow">{mode === "signin" ? "Welcome back" : "Create workspace"}</p>
          <h1 id="auth-title">{mode === "signin" ? "Sign in to HourLog" : "Start tracking hours"}</h1>
          <p>{mode === "signin" ? "Use your secure account to continue." : "Create an account to sync your history."}</p>
        </div>

        <div className="segmented" role="tablist" aria-label="Authentication mode">
          <button
            className={`segment ${mode === "signin" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            onClick={() => {
              setMode("signin");
              setMessage("");
              onNavigateAuth("signin");
            }}
          >
            Sign in
          </button>
          <button
            className={`segment ${mode === "signup" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            onClick={() => {
              setMode("signup");
              setMessage("");
              onNavigateAuth("signup");
            }}
          >
            Sign up
          </button>
        </div>

        {mode === "signin" ? (
          <form className="auth-form" onSubmit={handleSignIn}>
            <label>
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="primary-action" type="submit" disabled={pending}>
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleSignUp}>
            <label>
              <span>Name</span>
              <input name="name" type="text" autoComplete="name" required />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autoComplete="new-password" minLength="6" required />
            </label>
            <button className="primary-action" type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create account"}
            </button>
          </form>
        )}

        <p className="form-message" role="status" aria-live="polite">
          {message || (cloudAuthEnabled ? "Secure cloud account required." : "Supabase is not configured.")}
        </p>
      </div>
    </section>
  );
}

function ClockPanel({ activeSession, liveNow, onToggleClock }) {
  const isActive = Boolean(activeSession);
  const elapsed = activeSession ? liveNow.getTime() - new Date(activeSession.startTime).getTime() : 0;
  const longSession = elapsed > 12 * 60 * 60 * 1000;

  return (
    <section className="clock-panel" aria-labelledby="clock-heading">
      <div>
        <p className="eyebrow">{isActive ? "Logged in" : "Ready"}</p>
        <h2 id="clock-heading">{isActive ? formatClock(elapsed) : "00:00:00"}</h2>
        <p className="muted">
          {isActive ? `Started at ${formatTime(new Date(activeSession.startTime))}` : "No active office session."}
        </p>
        {longSession && <p className="warning-text">This session is over 12 hours. Please check if you forgot to logout.</p>}
      </div>
      <button className={`clock-button ${isActive ? "logout" : ""}`} type="button" onClick={onToggleClock}>
        <span className="clock-dot" aria-hidden="true" />
        <span>{isActive ? "Logout" : "Login"}</span>
      </button>
    </section>
  );
}

function StatsGrid({ completedSessions, liveNow, settings }) {
  const current = liveNow;
  const todaySessions = sessionsBetween(completedSessions, startOfDay(current), current);
  const weekSessions = sessionsBetween(completedSessions, startOfWeek(current), current);
  const monthSessions = sessionsBetween(completedSessions, startOfMonth(current), current);
  const dayCount = new Set(completedSessions.map((session) => dayKey(new Date(session.startTime)))).size || 1;
  const todayTotal = totalDuration(todaySessions, liveNow);
  const todayTarget = targetMillisecondsForRange(startOfDay(current), current, settings);
  const monthTarget = targetMillisecondsForRange(startOfMonth(current), endOfMonth(current), settings);
  const todayBalance = todayTotal - todayTarget;
  const stats = [
    ["Today", formatDuration(todayTotal)],
    ["Target balance", formatBalance(todayBalance)],
    ["This week", formatDuration(totalDuration(weekSessions, liveNow))],
    ["This month", formatDuration(totalDuration(monthSessions, liveNow))],
    ["Monthly target", formatDuration(monthTarget)],
    ["Average day", formatDuration(totalDuration(completedSessions, liveNow) / dayCount)],
  ];

  return (
    <section className="stats-grid" aria-label="Summary">
      {stats.map(([label, value]) => (
        <article className="stat-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

function InsightsPanel({ completedSessions, liveNow, settings }) {
  const current = liveNow;
  const monthStart = startOfMonth(current);
  const monthEnd = endOfMonth(current);
  const monthSessions = sessionsBetween(completedSessions, monthStart, current);
  const monthTotal = totalDuration(monthSessions, liveNow);
  const monthTarget = targetMillisecondsForRange(monthStart, monthEnd, settings);
  const groupedDays = groupSessionsByDay(completedSessions);
  const bestDay = groupedDays.reduce((best, day) => (!best || day.total > best.total ? day : best), null);
  const longestSession = completedSessions.reduce((best, session) => {
    if (!best || sessionDuration(session) > sessionDuration(best)) return session;
    return best;
  }, null);
  const averageSession = completedSessions.length ? totalDuration(completedSessions, liveNow) / completedSessions.length : 0;
  const streak = currentWorkStreak(completedSessions, settings, current);
  const monthProgress = monthTarget > 0 ? monthTotal / monthTarget : 0;
  const cards = [
    {
      icon: TrendingUp,
      label: "Monthly progress",
      value: formatPercent(monthProgress),
      detail: `${formatDuration(monthTotal)} of ${formatDuration(monthTarget)}`,
    },
    {
      icon: Activity,
      label: "Current streak",
      value: `${streak} ${streak === 1 ? "day" : "days"}`,
      detail: "Completed tracked workdays in a row",
    },
    {
      icon: Timer,
      label: "Average session",
      value: formatDuration(averageSession),
      detail: `${completedSessions.length} completed sessions`,
    },
    {
      icon: BarChart3,
      label: "Best day",
      value: bestDay ? formatDuration(bestDay.total) : "0h 00m",
      detail: bestDay ? formatDate(bestDay.date) : "No completed sessions yet",
    },
    {
      icon: ListChecks,
      label: "Longest session",
      value: longestSession ? formatDuration(sessionDuration(longestSession)) : "0h 00m",
      detail: longestSession ? formatDate(new Date(longestSession.startTime)) : "No session data yet",
    },
  ];

  return (
    <section className="insights-panel" aria-label="Work insights">
      <div className="section-header">
        <div>
          <p className="eyebrow">Insights</p>
          <h2>Work patterns</h2>
        </div>
      </div>
      <div className="insight-grid">
        {cards.map(({ icon: Icon, label, value, detail }) => (
          <article className="insight-card" key={label}>
            <Icon aria-hidden="true" size={19} />
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function RecentTimeline({ completedSessions }) {
  const recentDays = groupSessionsByDay(completedSessions).slice(0, 7);
  const maxTotal = Math.max(...recentDays.map((day) => day.total), 1);

  return (
    <section className="timeline-panel" aria-label="Recent work timeline">
      <div className="section-header">
        <div>
          <p className="eyebrow">Timeline</p>
          <h2>Last logged days</h2>
        </div>
      </div>
      {recentDays.length ? (
        <div className="timeline-list">
          {recentDays.map((day) => (
            <article className="timeline-row" key={dayKey(day.date)}>
              <div>
                <strong>{formatDate(day.date)}</strong>
                <span>
                  {day.sessions.length} {day.sessions.length === 1 ? "session" : "sessions"}
                  {day.breakCount ? `, ${day.breakCount} breaks` : ""}
                </span>
              </div>
              <div className="timeline-meter" aria-hidden="true">
                <span style={{ width: `${Math.max(6, (day.total / maxTotal) * 100)}%` }} />
              </div>
              <b>{formatDuration(day.total)}</b>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">No completed days yet. Your timeline will appear after your first logout.</div>
      )}
    </section>
  );
}

function TargetSettings({ settings, selectedMonth, onSelectMonth, onUpdateTarget, onUpdateTrackingStart, onAddHoliday, onRemoveHoliday }) {
  const [holidayDate, setHolidayDate] = useState(dayKey(new Date()));
  const [holidayReason, setHolidayReason] = useState("");
  const selectedMonthDate = monthStartFromKey(selectedMonth);
  const selectedMonthStart = startOfMonth(selectedMonthDate);
  const selectedMonthEnd = endOfMonth(selectedMonthDate);
  const monthWorkdays = workdayKeysBetween(selectedMonthStart, selectedMonthEnd, settings);
  const monthlyTarget = targetMillisecondsForRange(selectedMonthStart, selectedMonthEnd, settings);
  const sortedHolidays = [...settings.holidays].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className="settings-panel" aria-label="Work target">
      <div>
        <p className="eyebrow">Target</p>
        <h2>Monthly work target</h2>
        <p className="muted">
          {monthWorkdays.length} weekdays x {formatDuration(settings.dailyTargetHours * 60 * 60 * 1000)} = {formatDuration(monthlyTarget)}
        </p>
      </div>
      <div className="target-controls">
        <div className="target-month-grid">
          <label>
            <span>Target month</span>
            <input type="month" value={selectedMonth} onChange={(event) => onSelectMonth(event.target.value)} />
          </label>
          <label>
            <span>Tracking starts</span>
            <input type="month" value={settings.trackingStartMonth} onChange={(event) => onUpdateTrackingStart(event.target.value)} />
          </label>
        </div>
        <label className="target-input">
          <span>Hours per day</span>
          <input
            type="number"
            min="1"
            max="24"
            step="0.25"
            value={settings.dailyTargetHours}
            onChange={(event) => onUpdateTarget(Number(event.target.value))}
          />
        </label>
        <div className="holiday-control">
          <label>
            <span>Holiday</span>
            <input type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} />
          </label>
          <label>
            <span>Reason</span>
            <input value={holidayReason} onChange={(event) => setHolidayReason(event.target.value)} placeholder="PTO, sick leave..." />
          </label>
          <button
            className="tool-button"
            type="button"
            onClick={() => {
              onAddHoliday(holidayDate, holidayReason);
              setHolidayReason("");
            }}
          >
            Add
          </button>
        </div>
        {sortedHolidays.length > 0 && (
          <div className="holiday-list">
            {sortedHolidays.map((holiday) => (
              <button className="holiday-chip" type="button" key={holiday.date} onClick={() => onRemoveHoliday(holiday.date)}>
                {holiday.date}
                {holiday.reason && <span>{holiday.reason}</span>}
                <X aria-hidden="true" size={13} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MonthlyCalendar({ completedSessions, settings, currentDate }) {
  const calendarDays = buildMonthCalendar(currentDate, completedSessions, settings);
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(currentDate);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const statusLabels = {
    holiday: "Holiday",
    weekend: "Weekend",
    "logged-offday": "Logged",
    "not-tracked": "Not tracked",
    empty: "No log",
    short: "Short",
    over: "Over",
    "on-target": "On target",
    outside: "Outside",
  };

  return (
    <section className="calendar-panel" aria-label="Monthly calendar">
      <div className="section-header">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2>{monthLabel}</h2>
        </div>
        <div className="calendar-legend" aria-label="Calendar legend">
          <span className="legend-dot short" /> Short
          <span className="legend-dot over" /> Over
          <span className="legend-dot holiday" /> Holiday
        </div>
      </div>

      <div className="calendar-grid">
        {weekdays.map((weekday) => (
          <div className="calendar-weekday" key={weekday}>
            {weekday}
          </div>
        ))}
        {calendarDays.map((day) => (
          <article className={`calendar-day ${day.status}`} key={day.key}>
            <div className="calendar-date-row">
              <strong>{day.date.getDate()}</strong>
              <span>{day.holidayReason || statusLabels[day.status]}</span>
            </div>
            {day.inMonth && (
              <>
                <p>{day.logged ? formatDuration(day.logged) : "0h 00m"}</p>
                {day.target > 0 && <small>{formatBalance(day.balance)}</small>}
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ReportsPanel({ completedSessions, settings, selectedMonth }) {
  const [range, setRange] = useState("daily");
  const [customStart, setCustomStart] = useState(dayKey(startOfDay(new Date())));
  const [customEnd, setCustomEnd] = useState(dayKey(new Date()));
  const [start, end] = rangeDates(range, customStart, customEnd, selectedMonth);
  const filteredSessions = sessionsBetween(completedSessions, start, end);
  const total = totalDuration(filteredSessions);
  const uniqueDays = new Set(filteredSessions.map((session) => dayKey(new Date(session.startTime))));
  const targetWorkdays = workdayKeysBetween(start, end, settings);
  const targetTotal = targetMillisecondsForRange(start, end, settings);
  const balance = total - targetTotal;
  const buckets = makeBuckets(range, filteredSessions, start, end);
  const maxBucket = Math.max(...buckets.map((bucket) => bucket.total), 1);
  const ranges = [
    ["daily", "Daily"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"],
    ["last3", "Last 3 months"],
    ["custom", "Custom"],
  ];

  return (
    <div className="report-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>Analyse hours</h2>
        </div>
        <button className="tool-button" type="button" onClick={() => exportSessionsCsv(filteredSessions)}>
          <Download aria-hidden="true" size={17} />
          <span>CSV</span>
        </button>
      </div>

      <div className="filters" role="group" aria-label="Report range">
        {ranges.map(([key, label]) => (
          <button
            className={`filter ${range === key ? "active" : ""}`}
            type="button"
            key={key}
            onClick={() => setRange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="custom-range">
          <label>
            <span>Start</span>
            <input value={customStart} onChange={(event) => setCustomStart(event.target.value)} type="date" />
          </label>
          <label>
            <span>End</span>
            <input value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} type="date" />
          </label>
        </div>
      )}

      <div className="report-summary">
        <div>
          <span>Total</span>
          <strong>{formatDuration(total)}</strong>
        </div>
        <div>
          <span>Days</span>
          <strong>{uniqueDays.size}</strong>
        </div>
        <div>
          <span>Sessions</span>
          <strong>{filteredSessions.length}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{formatDuration(targetTotal)}</strong>
        </div>
        <div>
          <span>Workdays</span>
          <strong>{targetWorkdays.length}</strong>
        </div>
        <div>
          <span>Balance</span>
          <strong>{formatBalance(balance)}</strong>
        </div>
      </div>

      <div className="chart" aria-label="Hours chart">
        {!buckets.length || buckets.every((bucket) => bucket.total === 0) ? (
          <div className="empty-state">No completed sessions in this range.</div>
        ) : (
          buckets.map((bucket) => (
            <div className="bar-wrap" key={bucket.label}>
              <span className="bar-value">{formatDuration(bucket.total)}</span>
              <span className="bar" style={{ height: Math.max(5, (bucket.total / maxBucket) * 155) }} />
              <span className="bar-label">{bucket.label}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryPanel({ completedSessions, onUpdateSession }) {
  const groups = groupSessionsByDay(completedSessions).slice(0, 18);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ startTime: "", endTime: "", note: "" });
  const [editMessage, setEditMessage] = useState("");

  function startEdit(session) {
    setEditingId(session.id);
    setDraft({
      startTime: toDateTimeLocalValue(session.startTime),
      endTime: toDateTimeLocalValue(session.endTime),
      note: session.note || "",
    });
    setEditMessage("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditMessage("");
  }

  function saveEdit(session) {
    if (!draft.startTime || !draft.endTime) {
      setEditMessage("Start and end time are required.");
      return;
    }
    if (new Date(draft.endTime) <= new Date(draft.startTime)) {
      setEditMessage("Logout time must be after login time.");
      return;
    }
    onUpdateSession(session.id, {
      startTime: fromDateTimeLocalValue(draft.startTime),
      endTime: fromDateTimeLocalValue(draft.endTime),
      note: draft.note.trim(),
    });
    setEditingId(null);
    setEditMessage("");
  }

  return (
    <div className="history-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>Login and logout</h2>
        </div>
      </div>

      <div className="history-list">
        {!groups.length ? (
          <div className="empty-state">No completed office hours yet.</div>
        ) : (
          groups.map((group) => (
            <section className="history-day" key={dayKey(group.date)}>
              <header className="history-day-header">
                <div>
                  <strong>{formatDate(group.date)}</strong>
                  <span>{group.sessions.length} {group.sessions.length === 1 ? "session" : "sessions"}</span>
                  {group.breakCount > 0 && (
                    <span>{group.breakCount} {group.breakCount === 1 ? "break" : "breaks"} - {formatDuration(group.breakTotal)}</span>
                  )}
                </div>
                <div className="history-day-total">{formatDuration(group.total)}</div>
              </header>

              {group.sessions.map((session, index) => {
                const start = new Date(session.startTime);
                const end = new Date(session.endTime);
                const isEditing = editingId === session.id;
                return (
                  <article className="history-item" key={session.id}>
                    {isEditing ? (
                      <div className="edit-session">
                        <div className="edit-grid">
                          <label>
                            <span>Login</span>
                            <input
                              type="datetime-local"
                              value={draft.startTime}
                              onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))}
                            />
                          </label>
                          <label>
                            <span>Logout</span>
                            <input
                              type="datetime-local"
                              value={draft.endTime}
                              onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))}
                            />
                          </label>
                        </div>
                        <label>
                          <span>Note</span>
                          <textarea
                            value={draft.note}
                            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                            rows="3"
                            placeholder="Work summary, client call, lunch adjustment..."
                          />
                        </label>
                        {editMessage && <p className="form-message compact">{editMessage}</p>}
                        <div className="edit-actions">
                          <button className="tool-button" type="button" onClick={() => saveEdit(session)}>
                            <Save aria-hidden="true" size={16} />
                            <span>Save</span>
                          </button>
                          <button className="tool-button ghost" type="button" onClick={cancelEdit}>
                            <X aria-hidden="true" size={16} />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <strong>Session {index + 1}</strong>
                          <p>
                            {formatTime(start)} - {formatTime(end)}
                          </p>
                          {session.note && <p className="session-note">{session.note}</p>}
                        </div>
                        <div className="history-side">
                          <div className="history-hours">{formatDuration(sessionDuration(session))}</div>
                          <button className="icon-mini" type="button" onClick={() => startEdit(session)} aria-label="Edit session">
                            <Pencil aria-hidden="true" size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function AddSessionPanel({ selectedMonth, onAddSession }) {
  const defaultStart = `${selectedMonth || monthKey(new Date())}-01T09:00`;
  const defaultEnd = `${selectedMonth || monthKey(new Date())}-01T15:30`;
  const [draft, setDraft] = useState({ startTime: defaultStart, endTime: defaultEnd, note: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      startTime: `${selectedMonth || monthKey(new Date())}-01T09:00`,
      endTime: `${selectedMonth || monthKey(new Date())}-01T15:30`,
    }));
  }, [selectedMonth]);

  function saveSession(event) {
    event.preventDefault();
    if (!draft.startTime || !draft.endTime) {
      setMessage("Login and logout time are required.");
      return;
    }
    if (new Date(draft.endTime) <= new Date(draft.startTime)) {
      setMessage("Logout time must be after login time.");
      return;
    }
    onAddSession({
      startTime: fromDateTimeLocalValue(draft.startTime),
      endTime: fromDateTimeLocalValue(draft.endTime),
      note: draft.note.trim(),
    });
    setDraft({ startTime: defaultStart, endTime: defaultEnd, note: "" });
    setMessage("Session added.");
  }

  return (
    <section className="add-session-panel" aria-label="Add session">
      <div className="section-header">
        <div>
          <p className="eyebrow">Manual</p>
          <h2>Add missed session</h2>
        </div>
      </div>
      <form className="add-session-form" onSubmit={saveSession}>
        <div className="edit-grid">
          <label>
            <span>Login</span>
            <input
              type="datetime-local"
              value={draft.startTime}
              onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))}
            />
          </label>
          <label>
            <span>Logout</span>
            <input
              type="datetime-local"
              value={draft.endTime}
              onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))}
            />
          </label>
        </div>
        <label>
          <span>Note</span>
          <textarea
            rows="3"
            value={draft.note}
            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            placeholder="Manual entry, old month correction..."
          />
        </label>
        <div className="add-session-actions">
          <button className="tool-button" type="submit">
            <Save aria-hidden="true" size={16} />
            <span>Add session</span>
          </button>
          {message && <p className="form-message compact">{message}</p>}
        </div>
      </form>
    </section>
  );
}

function Dashboard({ user, data, setData, onSignOut, cloudStatus }) {
  const [liveNow, setLiveNow] = useState(new Date());
  const [selectedMonth, setSelectedMonth] = useState(monthKey(new Date()));
  const [activeView, setActiveView] = useState("overview");
  const settings = getUserSettings(data, user.id);
  const userSessions = data.sessions.filter((session) => session.userId === user.id);
  const activeSession = userSessions.find((session) => !session.endTime);
  const completedSessions = [...userSessions]
    .filter((session) => session.endTime)
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  const isCloudUser = user.provider === "supabase";

  useEffect(() => {
    const timer = window.setInterval(() => setLiveNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function syncCloud(action) {
    if (!isCloudUser) return;
    action().catch((error) => {
      console.warn("Supabase sync failed", error);
    });
  }

  function toggleClock() {
    const now = new Date().toISOString();
    const changedSession = activeSession
      ? { ...activeSession, endTime: now }
      : {
          id: createId("session"),
          userId: user.id,
          startTime: now,
          endTime: null,
          note: "",
        };

    setData((current) => {
      const next = activeSession
        ? {
            ...current,
            sessions: current.sessions.map((session) => (session.id === activeSession.id ? changedSession : session)),
          }
        : {
            ...current,
            sessions: [...current.sessions, changedSession],
          };
      writeDatabase(next);
      return next;
    });
    syncCloud(() => upsertRemoteSession(user.id, changedSession));
  }

  function updateDailyTarget(value) {
    const dailyTargetHours = Number.isFinite(value) ? Math.min(24, Math.max(1, value)) : 6.5;
    const nextSettings = {
      ...settings,
      dailyTargetHours,
      targetVersion: 2,
    };
    setData((current) => {
      const next = {
        ...current,
        settings: {
          ...(current.settings || {}),
          [user.id]: nextSettings,
        },
      };
      writeDatabase(next);
      return next;
    });
    syncCloud(() => upsertRemoteSettings(user.id, nextSettings));
  }

  function updateTrackingStart(monthValue) {
    if (!monthValue) return;
    const nextSettings = {
      ...settings,
      trackingStartMonth: monthValue,
      targetVersion: 2,
    };
    setData((current) => {
      const next = {
        ...current,
        settings: {
          ...(current.settings || {}),
          [user.id]: nextSettings,
        },
      };
      writeDatabase(next);
      return next;
    });
    syncCloud(() => upsertRemoteSettings(user.id, nextSettings));
  }

  function updateHolidays(updater) {
    setData((current) => {
      const currentSettings = getUserSettings(current, user.id);
      const holidays = updater(currentSettings.holidays);
      const next = {
        ...current,
        settings: {
          ...(current.settings || {}),
          [user.id]: {
            ...currentSettings,
            holidays,
            targetVersion: 2,
          },
        },
      };
      writeDatabase(next);
      return next;
    });
  }

  function addHoliday(dateKeyValue, reason = "") {
    if (!dateKeyValue) return;
    const holiday = { date: dateKeyValue, reason: reason.trim() };
    updateHolidays((holidays) => {
      const next = holidays.filter((holiday) => holiday.date !== dateKeyValue);
      next.push(holiday);
      return next.sort((a, b) => a.date.localeCompare(b.date));
    });
    syncCloud(() => upsertRemoteHoliday(user.id, holiday));
  }

  function removeHoliday(dateKeyValue) {
    updateHolidays((holidays) => holidays.filter((holiday) => holiday.date !== dateKeyValue));
    syncCloud(() => deleteRemoteHoliday(user.id, dateKeyValue));
  }

  function updateSession(sessionId, updates) {
    const updatedSession = userSessions.find((session) => session.id === sessionId);
    const remoteSession = updatedSession ? { ...updatedSession, ...updates } : null;
    setData((current) => {
      const next = {
        ...current,
        sessions: current.sessions.map((session) => (session.id === sessionId ? { ...session, ...updates } : session)),
      };
      writeDatabase(next);
      return next;
    });
    if (remoteSession) syncCloud(() => upsertRemoteSession(user.id, remoteSession));
  }

  function addManualSession(session) {
    const manualSession = {
      id: createId("session"),
      userId: user.id,
      ...session,
    };
    setData((current) => {
      const next = {
        ...current,
        sessions: [...current.sessions, manualSession],
      };
      writeDatabase(next);
      return next;
    });
    syncCloud(() => upsertRemoteSession(user.id, manualSession));
  }

  const views = [
    { id: "overview", label: "Overview" },
    { id: "target", label: "Target" },
    { id: "calendar", label: "Calendar" },
    { id: "reports", label: "Reports" },
    { id: "history", label: "History" },
    { id: "manual", label: "Manual" },
  ];

  const activeViewLabel = views.find((view) => view.id === activeView)?.label || "Overview";

  return (
    <main className="dashboard-layout">
      <aside className="side-panel" aria-label="Dashboard navigation">
        <div>
          <p className="eyebrow">{formatDate(liveNow)}</p>
          <h1>HourLog</h1>
          <p className="muted">Office Hours, {user.name.split(" ")[0]}</p>
          {cloudStatus && <p className="sync-status">{cloudStatus}</p>}
        </div>
        <nav className="side-nav">
          {views.map((view) => (
            <button
              className={activeView === view.id ? "active" : ""}
              type="button"
              key={view.id}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </nav>
        <button className="side-signout" type="button" onClick={onSignOut}>
          <LogOut aria-hidden="true" size={18} />
          <span>Sign out</span>
        </button>
      </aside>

      <section className="dashboard-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeViewLabel}</p>
            <h1>Office Hours, {user.name.split(" ")[0]}</h1>
          </div>
          <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
            <LogOut aria-hidden="true" size={22} strokeWidth={2.2} />
          </button>
        </header>

        <nav className="mobile-nav" aria-label="Dashboard sections">
          {views.map((view) => (
            <button
              className={activeView === view.id ? "active" : ""}
              type="button"
              key={view.id}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </nav>

        {activeView === "overview" && (
          <section className="dashboard-view">
            <ClockPanel activeSession={activeSession} liveNow={liveNow} onToggleClock={toggleClock} />
            <StatsGrid completedSessions={completedSessions} liveNow={liveNow} settings={settings} />
            <InsightsPanel completedSessions={completedSessions} liveNow={liveNow} settings={settings} />
            <RecentTimeline completedSessions={completedSessions} />
          </section>
        )}

        {activeView === "target" && (
          <section className="dashboard-view">
            <TargetSettings
              settings={settings}
              selectedMonth={selectedMonth}
              onSelectMonth={setSelectedMonth}
              onUpdateTarget={updateDailyTarget}
              onUpdateTrackingStart={updateTrackingStart}
              onAddHoliday={addHoliday}
              onRemoveHoliday={removeHoliday}
            />
          </section>
        )}

        {activeView === "calendar" && (
          <section className="dashboard-view">
            <MonthlyCalendar completedSessions={completedSessions} settings={settings} currentDate={monthStartFromKey(selectedMonth)} />
          </section>
        )}

        {activeView === "reports" && (
          <section className="dashboard-view">
            <ReportsPanel completedSessions={completedSessions} settings={settings} selectedMonth={selectedMonth} />
          </section>
        )}

        {activeView === "history" && (
          <section className="dashboard-view">
            <HistoryPanel completedSessions={completedSessions} onUpdateSession={updateSession} />
          </section>
        )}

        {activeView === "manual" && (
          <section className="dashboard-view">
            <AddSessionPanel selectedMonth={selectedMonth} onAddSession={addManualSession} />
          </section>
        )}
      </section>
    </main>
  );
}

function getAppRoute() {
  if (typeof window === "undefined") return "/";
  const path = window.location.pathname;
  if (path === "/signin" || path === "/signup" || path === "/app") return path;
  return "/";
}

export default function App() {
  const [data, setData] = useState(readDatabase);
  const [currentUserId, setCurrentUserId] = useState(readCurrentUserId);
  const [cloudStatus, setCloudStatus] = useState(isSupabaseConfigured ? "Supabase ready" : "Supabase not configured");
  const [route, setRoute] = useState(getAppRoute);
  const loadedCloudUsers = useRef(new Set());
  const user = useMemo(() => data.users.find((candidate) => candidate.id === currentUserId) || null, [data.users, currentUserId]);

  function navigate(path) {
    window.history.pushState({}, "", path);
    setRoute(getAppRoute());
  }

  async function loadCloudDataForUser(userId) {
    if (!supabase || loadedCloudUsers.current.has(userId)) return;
    loadedCloudUsers.current.add(userId);
    const localSnapshot = readDatabase();
    const localSessions = localSnapshot.sessions.filter((session) => session.userId === userId);
    const localSettings = getUserSettings(localSnapshot, userId);
    setCloudStatus("Syncing Supabase data...");
    try {
      const cloudData = await fetchHourLogData(userId);
      if (!cloudData) return;
      const sessionsById = new Map();
      localSessions.forEach((session) => sessionsById.set(session.id, session));
      cloudData.sessions.forEach((session) => sessionsById.set(session.id, session));
      const holidaysByDate = new Map();
      localSettings.holidays.forEach((holiday) => holidaysByDate.set(holiday.date, holiday));
      cloudData.settings.holidays.forEach((holiday) => holidaysByDate.set(holiday.date, holiday));
      const mergedSettings = {
        ...(cloudData.hasSettings ? cloudData.settings : localSettings),
        holidays: [...holidaysByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
        targetVersion: 2,
      };
      const mergedSessions = [...sessionsById.values()];
      setData((current) => {
        const next = {
          ...current,
          sessions: [...current.sessions.filter((session) => session.userId !== userId), ...mergedSessions],
          settings: {
            ...(current.settings || {}),
            [userId]: mergedSettings,
          },
        };
        writeDatabase(next);
        return next;
      });
      await Promise.all([
        upsertRemoteSettings(userId, mergedSettings),
        ...mergedSettings.holidays.map((holiday) => upsertRemoteHoliday(userId, holiday)),
        ...mergedSessions.map((session) => upsertRemoteSession(userId, session)),
      ]);
      setCloudStatus("Supabase sync active");
    } catch (error) {
      console.warn("Unable to load Supabase data", error);
      setCloudStatus("Supabase tables not ready; using local storage");
    }
  }

  function ensureUser(authUser, fallbackName = "User") {
    const userId = authUser.id;
    const email = authUser.email || "";
    const name = authUser.user_metadata?.name || fallbackName || email.split("@")[0] || "User";
    setData((current) => {
      if (current.users.some((candidate) => candidate.id === userId)) {
        const next = {
          ...current,
          users: current.users.map((candidate) =>
            candidate.id === userId ? { ...candidate, name, email, provider: "supabase" } : candidate
          ),
        };
        writeDatabase(next);
        return next;
      }
      const next = {
        ...current,
        users: [
          ...current.users,
          {
            id: userId,
            name,
            email,
            password: "",
            provider: "supabase",
          },
        ],
      };
      writeDatabase(next);
      return next;
    });
    writeCurrentUserId(userId);
    setCurrentUserId(userId);
    loadCloudDataForUser(userId);
  }

  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    function syncRoute() {
      setRoute(getAppRoute());
    }
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (sessionData.session?.user) ensureUser(sessionData.session.user);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        ensureUser(session.user);
      } else {
        clearCurrentUserId();
        setCurrentUserId(null);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(email, password) {
    if (supabase) {
      const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return error.message;
      if (authData.user) ensureUser(authData.user);
      navigate("/app");
      return "";
    }
    const foundUser = data.users.find(
      (candidate) => candidate.email.toLowerCase() === email.toLowerCase() && candidate.password === password
    );
    if (!foundUser) return "Email or password is incorrect.";
    writeCurrentUserId(foundUser.id);
    setCurrentUserId(foundUser.id);
    navigate("/app");
    return "";
  }

  async function signUp(name, email, password) {
    if (supabase) {
      const { data: authData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });
      if (error) return error.message;
      if (authData.user) ensureUser(authData.user, name);
      if (authData.session) navigate("/app");
      if (!authData.session) return "Account created. Please confirm your email if Supabase requires it, then sign in.";
      return "";
    }
    if (data.users.some((candidate) => candidate.email.toLowerCase() === email.toLowerCase())) {
      return "This email already has an account.";
    }
    const nextUser = {
      id: createId("user"),
      name,
      email,
      password,
    };
    const next = { ...data, users: [...data.users, nextUser] };
    writeDatabase(next);
    setData(next);
    writeCurrentUserId(nextUser.id);
    setCurrentUserId(nextUser.id);
    navigate("/app");
    return "";
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    clearCurrentUserId();
    setCurrentUserId(null);
    navigate("/signin");
  }

  const authMode = route === "/signup" ? "signup" : "signin";

  return (
    <div className="app-shell">
      {user ? (
        <Dashboard user={user} data={data} setData={setData} onSignOut={signOut} cloudStatus={cloudStatus} />
      ) : route === "/" ? (
        <HomeScreen onGetStarted={() => navigate("/signup")} onSignIn={() => navigate("/signin")} />
      ) : (
        <AuthScreen
          onSignIn={signIn}
          onSignUp={signUp}
          cloudAuthEnabled={isSupabaseConfigured}
          initialMode={authMode}
          onNavigateHome={() => navigate("/")}
          onNavigateAuth={(mode) => navigate(mode === "signup" ? "/signup" : "/signin")}
        />
      )}
    </div>
  );
}
