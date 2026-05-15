const summaryEl = document.getElementById("summary");
const onlineRowsEl = document.getElementById("onlineRows");
const onlineCountEl = document.getElementById("onlineCount");
const platformsEl = document.getElementById("platforms");
const topTodayEl = document.getElementById("topToday");
const topTotalEl = document.getElementById("topTotal");
const hourlyEl = document.getElementById("hourly");
const lastUpdatedEl = document.getElementById("lastUpdated");
const connectionDotEl = document.getElementById("connectionDot");

const numberFormatter = new Intl.NumberFormat("ar-IQ");
const hourFormatter = new Intl.NumberFormat("ar-IQ", {
  maximumFractionDigits: 1
});

function formatNumber(value) {
  return numberFormatter.format(Number(value || 0));
}

function formatHours(value) {
  return `${hourFormatter.format(Number(value || 0))} ساعة`;
}

function platformLabel(platforms) {
  const list = Array.isArray(platforms) ? platforms : [platforms];
  return list.filter(Boolean).join(" / ") || "غير محدد";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metric(label, value, hint) {
  return `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </article>
  `;
}

function renderSummary(data) {
  const summary = data.summary;
  summaryEl.innerHTML = [
    metric("نشطين الآن", formatNumber(summary.activeNowUsers), `${formatNumber(summary.foregroundNowDevices)} جهاز مفتوح فعلياً`),
    metric("نشطين آخر 15 دقيقة", formatNumber(summary.recent15Users), `${formatNumber(summary.activeNowDevices)} جهاز متصل حديثاً`),
    metric("استخدام اليوم", formatHours(summary.todayForegroundHours), `تاريخ بغداد: ${data.todayKey}`),
    metric("إجمالي الاستخدام", formatHours(summary.totalForegroundHours), `${formatNumber(summary.totalSessions)} جلسة محفوظة`),
    metric("المستخدمين", formatNumber(summary.allUsers), `${formatNumber(summary.usersWithProfiles)} حساب عنده بروفايل`),
    metric("الأجهزة", formatNumber(summary.devices), `${formatNumber(summary.usersWithUsage)} مستخدم عنده بيانات استخدام`),
    metric("البروفايلات", formatNumber(summary.profileCount), "أسماء الأطفال والحسابات"),
    metric("آخر تحديث", data.generatedAtLocal, `يتحدث كل ${formatNumber(data.freshness.refreshSeconds)} ثانية بالمتصفح`)
  ].join("");
}

function renderOnline(data) {
  onlineCountEl.textContent = formatNumber(data.onlineNow.length);

  if (!data.onlineNow.length) {
    onlineRowsEl.innerHTML = `<tr><td colspan="6" class="empty">ماكو مستخدمين نشطين خلال آخر 5 دقائق</td></tr>`;
    return;
  }

  onlineRowsEl.innerHTML = data.onlineNow
    .map((user) => {
      const stateClass = user.status === "open" ? "" : " recent";
      const stateText = user.status === "open" ? "فاتح التطبيق" : "نشط قبل قليل";
      return `
        <tr>
          <td>
            <div class="name-cell">
              <strong>${escapeHtml(user.name)}</strong>
              <small>${escapeHtml(user.userId)}</small>
            </div>
          </td>
          <td><span class="state${stateClass}">${stateText}</span></td>
          <td>${escapeHtml(platformLabel(user.platforms))}</td>
          <td>${formatNumber(user.devices)}</td>
          <td>${formatHours(user.todayHours)}</td>
          <td>${escapeHtml(user.lastSeenLabel)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPlatforms(data) {
  if (!data.platforms.length) {
    platformsEl.innerHTML = `<div class="empty">ماكو بيانات منصات</div>`;
    return;
  }

  platformsEl.innerHTML = data.platforms
    .map((platform) => `
      <div class="platform-row">
        <div>
          <strong>${escapeHtml(platform.platform.toUpperCase())}</strong>
          <span>${formatNumber(platform.users)} مستخدم، ${formatNumber(platform.activeNow)} جهاز نشط الآن</span>
        </div>
        <div class="rank-value">${formatNumber(platform.devices)}</div>
      </div>
    `)
    .join("");
}

function renderRanks(element, rows) {
  if (!rows.length) {
    element.innerHTML = `<div class="empty">ماكو بيانات استخدام</div>`;
    return;
  }

  element.innerHTML = rows.slice(0, 10)
    .map((user) => `
      <div class="rank-row">
        <div>
          <strong>${formatNumber(user.rank)}. ${escapeHtml(user.name)}</strong>
          <span>${escapeHtml(platformLabel(user.platforms))}، ${formatNumber(user.devices)} جهاز، آخر ظهور ${escapeHtml(user.lastSeenLabel)}</span>
        </div>
        <div class="rank-value">${formatHours(user.hours)}</div>
      </div>
    `)
    .join("");
}

function renderHourly(data) {
  const max = Math.max(...data.hourly.map((item) => item.usageHours), 1);

  hourlyEl.innerHTML = data.hourly
    .map((item) => {
      const height = Math.max(6, Math.round((item.usageHours / max) * 190));
      return `
        <div class="bar-item" title="${escapeHtml(item.hour)} - ${formatHours(item.usageHours)}">
          <div class="bar" style="height:${height}px"></div>
          <div class="bar-label">${escapeHtml(item.hour)}</div>
        </div>
      `;
    })
    .join("");
}

async function loadStats() {
  try {
    const response = await fetch(`data/stats.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    renderSummary(data);
    renderOnline(data);
    renderPlatforms(data);
    renderRanks(topTodayEl, data.topToday);
    renderRanks(topTotalEl, data.topTotal);
    renderHourly(data);

    lastUpdatedEl.textContent = `آخر تحديث: ${data.generatedAtLocal}`;
    connectionDotEl.classList.add("ready");
  } catch (error) {
    lastUpdatedEl.textContent = "تعذر تحميل الإحصائيات";
    connectionDotEl.classList.remove("ready");
    console.error(error);
  }
}

loadStats();
setInterval(loadStats, 30_000);
