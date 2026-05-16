import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const DATABASE_URL = "https://xygen-44f29-default-rtdb.firebaseio.com";
const BAGHDAD_TZ = "Asia/Baghdad";
const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function readCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  }

  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS");
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function maxTimestamp(...values) {
  return Math.max(0, ...values.map(asNumber));
}

function dateKey(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BAGHDAD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localTime(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
    timeZone: BAGHDAD_TZ,
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false
  }).format(new Date(ms));
}

function hourLabel(ms) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BAGHDAD_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(ms));
}

function secondsToHours(seconds) {
  return Math.round((seconds / 3600) * 10) / 10;
}

function normalizePlatform(platform) {
  const value = String(platform || "unknown").toLowerCase();
  if (value.includes("ios") || value.includes("iphone") || value.includes("ipad")) return "ios";
  if (value.includes("android")) return "android";
  if (value.includes("web")) return "web";
  return value || "unknown";
}

function userDisplayName(userId, profileIds, profiles) {
  const userProfiles = asObject(profiles[userId]);
  const candidates = profileIds.length ? profileIds : Object.keys(userProfiles);

  for (const profileId of candidates) {
    const profile = userProfiles[profileId];
    if (profile?.name) return profile.name;
  }

  const firstProfile = Object.values(userProfiles).find((profile) => profile?.name);
  return firstProfile?.name || userId;
}

function ensureUser(map, userId) {
  if (!map.has(userId)) {
    map.set(userId, {
      userId,
      profileIds: new Set(),
      platforms: new Set(),
      devices: new Set(),
      sessionCount: 0,
      foregroundDevices: 0,
      recentDevices: 0,
      presenceDevices: 0,
      todaySeconds: 0,
      totalSeconds: 0,
      sessionForegroundSeconds: 0,
      lastSeen: 0,
      lastForegroundAt: 0,
      lastBackgroundAt: 0
    });
  }
  return map.get(userId);
}

function topUsers(users, profiles, field, limit = 20) {
  return [...users.values()]
    .filter((user) => user[field] > 0)
    .sort((a, b) => b[field] - a[field])
    .slice(0, limit)
    .map((user, index) => ({
      rank: index + 1,
      userId: user.userId,
      name: userDisplayName(user.userId, [...user.profileIds], profiles),
      platforms: [...user.platforms].filter(Boolean).sort(),
      devices: user.devices.size,
      seconds: Math.round(user[field]),
      hours: secondsToHours(user[field]),
      lastSeen: user.lastSeen,
      lastSeenLabel: localTime(user.lastSeen)
    }));
}

function buildEmptyHours(now) {
  return Array.from({ length: 24 }, (_, offset) => {
    const ms = now - (23 - offset) * ONE_HOUR;
    return {
      hour: hourLabel(ms),
      activeUsers: 0,
      foregroundUsers: 0,
      usageSeconds: 0,
      usageHours: 0
    };
  });
}

function buildEmptyDays(now, count = 7) {
  return Array.from({ length: count }, (_, offset) => {
    const key = dateKey(now - offset * 24 * ONE_HOUR);
    return {
      date: key,
      usageSeconds: 0,
      usageHours: 0,
      users: new Set(),
      devices: 0,
      percentOf7Days: 0
    };
  });
}

const credential = readCredential();

if (!getApps().length) {
  initializeApp({
    credential: cert(credential),
    databaseURL: DATABASE_URL
  });
}

const db = getDatabase();
const [usageSnapshot, sessionsSnapshot, presenceSnapshot, profilesSnapshot] = await Promise.all([
  db.ref("usage").get(),
  db.ref("sessions").get(),
  db.ref("presence").get(),
  db.ref("profiles").get()
]);

const usage = asObject(usageSnapshot.val());
const sessions = asObject(sessionsSnapshot.val());
const presence = asObject(presenceSnapshot.val());
const profiles = asObject(profilesSnapshot.val());
const users = new Map();
const now = Date.now();
const today = dateKey(now);
const platformStats = new Map();
const hourly = buildEmptyHours(now);
const daily7 = buildEmptyDays(now);
const daily7ByDate = new Map(daily7.map((day) => [day.date, day]));
const recentOnlineCutoff = now - FIVE_MINUTES;
const recent15Cutoff = now - FIFTEEN_MINUTES;
let deviceCount = 0;
let totalSessionCount = 0;
let foregroundDeviceCount = 0;
let activeDeviceCount = 0;
let todayForegroundSeconds = 0;
let totalForegroundSeconds = 0;

function platformBucket(platform) {
  const key = normalizePlatform(platform);
  if (!platformStats.has(key)) {
    platformStats.set(key, { platform: key, devices: 0, users: new Set(), foregroundNow: 0, activeNow: 0 });
  }
  return platformStats.get(key);
}

for (const [userId, deviceMap] of Object.entries(usage)) {
  for (const [deviceId, rawDevice] of Object.entries(asObject(deviceMap))) {
    const device = asObject(rawDevice);
    const user = ensureUser(users, userId);
    const platform = normalizePlatform(device.platform);
    const lastSeen = maxTimestamp(device.updatedAt, device.lastForegroundAt, device.lastBackgroundAt);
    const profileId = device.profileId ? String(device.profileId) : "";
    const deviceTodaySeconds = device.todayKey === today ? asNumber(device.todayForegroundSeconds) : 0;
    const deviceDailySeconds = asNumber(device.todayForegroundSeconds);
    const deviceTotalSeconds = asNumber(device.totalForegroundSeconds);
    const isActiveNow = lastSeen >= recentOnlineCutoff;
    const isForegroundNow = device.isForeground === true && isActiveNow;

    user.devices.add(deviceId);
    if (profileId) user.profileIds.add(profileId);
    user.platforms.add(platform);
    user.lastSeen = Math.max(user.lastSeen, lastSeen);
    user.lastForegroundAt = Math.max(user.lastForegroundAt, asNumber(device.lastForegroundAt));
    user.lastBackgroundAt = Math.max(user.lastBackgroundAt, asNumber(device.lastBackgroundAt));
    user.todaySeconds += deviceTodaySeconds;
    user.totalSeconds += deviceTotalSeconds;
    user.sessionForegroundSeconds += asNumber(device.sessionForegroundSeconds);
    if (isActiveNow) user.recentDevices += 1;
    if (isForegroundNow) user.foregroundDevices += 1;

    const dailyBucket = daily7ByDate.get(device.todayKey);
    if (dailyBucket && deviceDailySeconds > 0) {
      dailyBucket.usageSeconds += deviceDailySeconds;
      dailyBucket.devices += 1;
      dailyBucket.users.add(userId);
    }

    const bucket = platformBucket(platform);
    bucket.devices += 1;
    bucket.users.add(userId);
    if (isActiveNow) bucket.activeNow += 1;
    if (isForegroundNow) bucket.foregroundNow += 1;

    const hour = hourly[hourly.length - 1 - Math.min(23, Math.floor((now - lastSeen) / ONE_HOUR))];
    if (hour && lastSeen) {
      hour.activeUsers += isActiveNow ? 1 : 0;
      hour.foregroundUsers += isForegroundNow ? 1 : 0;
      hour.usageSeconds += deviceTodaySeconds;
    }

    deviceCount += 1;
    totalForegroundSeconds += deviceTotalSeconds;
    todayForegroundSeconds += deviceTodaySeconds;
    if (isActiveNow) activeDeviceCount += 1;
    if (isForegroundNow) foregroundDeviceCount += 1;
  }
}

for (const [userId, sessionMap] of Object.entries(sessions)) {
  const user = ensureUser(users, userId);
  for (const [sessionId, rawSession] of Object.entries(asObject(sessionMap))) {
    const session = asObject(rawSession);
    const platform = normalizePlatform(session.platform);
    const profileId = session.profileId ? String(session.profileId) : "";
    const lastSeen = maxTimestamp(session.lastSeen, session.startedAt);

    user.sessionCount += 1;
    user.devices.add(sessionId);
    user.platforms.add(platform);
    user.lastSeen = Math.max(user.lastSeen, lastSeen);
    if (profileId) user.profileIds.add(profileId);
    totalSessionCount += 1;
  }
}

for (const [userId, deviceMap] of Object.entries(presence)) {
  const user = ensureUser(users, userId);
  for (const [deviceId, rawPresence] of Object.entries(asObject(deviceMap))) {
    const device = asObject(rawPresence);
    const lastOnline = asNumber(device.lastOnline);
    user.devices.add(deviceId);
    user.lastSeen = Math.max(user.lastSeen, lastOnline);
    if (device.online === true && lastOnline >= recentOnlineCutoff) {
      user.presenceDevices += 1;
    }
  }
}

for (const [userId, profileMap] of Object.entries(profiles)) {
  const user = ensureUser(users, userId);
  for (const profileId of Object.keys(asObject(profileMap))) {
    user.profileIds.add(profileId);
  }
}

for (const hour of hourly) {
  hour.usageHours = secondsToHours(hour.usageSeconds);
}

const daily7TotalSeconds = daily7.reduce((sum, day) => sum + day.usageSeconds, 0);
const dailyLast7 = daily7.map((day) => ({
  date: day.date,
  usageSeconds: Math.round(day.usageSeconds),
  usageHours: secondsToHours(day.usageSeconds),
  users: day.users.size,
  devices: day.devices,
  percentOf7Days: daily7TotalSeconds
    ? Math.round((day.usageSeconds / daily7TotalSeconds) * 1000) / 10
    : 0
}));

const onlineNow = [...users.values()]
  .filter((user) => user.foregroundDevices > 0 || user.recentDevices > 0 || user.presenceDevices > 0)
  .sort((a, b) => b.lastSeen - a.lastSeen)
  .map((user) => ({
    userId: user.userId,
    name: userDisplayName(user.userId, [...user.profileIds], profiles),
    platforms: [...user.platforms].filter(Boolean).sort(),
    devices: user.devices.size,
    foregroundDevices: user.foregroundDevices,
    activeDevices: user.recentDevices,
    presenceDevices: user.presenceDevices,
    todayHours: secondsToHours(user.todaySeconds),
    totalHours: secondsToHours(user.totalSeconds),
    lastSeen: user.lastSeen,
    lastSeenLabel: localTime(user.lastSeen),
    status: user.foregroundDevices > 0 ? "open" : "recent"
  }));

const recent15 = [...users.values()]
  .filter((user) => user.lastSeen >= recent15Cutoff)
  .sort((a, b) => b.lastSeen - a.lastSeen)
  .map((user) => ({
    userId: user.userId,
    name: userDisplayName(user.userId, [...user.profileIds], profiles),
    platforms: [...user.platforms].filter(Boolean).sort(),
    devices: user.devices.size,
    todayHours: secondsToHours(user.todaySeconds),
    lastSeen: user.lastSeen,
    lastSeenLabel: localTime(user.lastSeen)
  }));

const platformBreakdown = [...platformStats.values()]
  .map((item) => ({
    platform: item.platform,
    devices: item.devices,
    users: item.users.size,
    activeNow: item.activeNow,
    foregroundNow: item.foregroundNow
  }))
  .sort((a, b) => b.devices - a.devices);

const profileCount = Object.values(profiles).reduce((sum, profileMap) => sum + Object.keys(asObject(profileMap)).length, 0);
const usersWithProfiles = Object.keys(profiles).length;
const usersWithUsage = Object.keys(usage).length;
const usersWithSessions = Object.keys(sessions).length;
const allUserCount = users.size;

const output = {
  generatedAt: new Date(now).toISOString(),
  generatedAtMs: now,
  generatedAtLocal: localTime(now),
  timezone: BAGHDAD_TZ,
  todayKey: today,
  freshness: {
    onlineWindowMinutes: 5,
    recentWindowMinutes: 15,
    refreshSeconds: 30
  },
  summary: {
    allUsers: allUserCount,
    usersWithProfiles,
    usersWithUsage,
    usersWithSessions,
    profileCount,
    devices: deviceCount,
    activeNowUsers: onlineNow.length,
    activeNowDevices: activeDeviceCount,
    foregroundNowDevices: foregroundDeviceCount,
    recent15Users: recent15.length,
    totalSessions: totalSessionCount,
    todayForegroundSeconds: Math.round(todayForegroundSeconds),
    todayForegroundHours: secondsToHours(todayForegroundSeconds),
    totalForegroundSeconds: Math.round(totalForegroundSeconds),
    totalForegroundHours: secondsToHours(totalForegroundSeconds)
  },
  onlineNow,
  recent15,
  topToday: topUsers(users, profiles, "todaySeconds"),
  topTotal: topUsers(users, profiles, "totalSeconds"),
  platforms: platformBreakdown,
  dailyLast7,
  hourly
};

mkdirSync(resolve("dist", "data"), { recursive: true });
writeFileSync(resolve("dist", "data", "stats.json"), JSON.stringify(output, null, 2));
console.log(`Generated stats for ${allUserCount} users, ${onlineNow.length} active now.`);

if (typeof db.goOffline === "function") {
  db.goOffline();
}

process.exit(0);
