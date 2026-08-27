// KRITIK: populasyon t0 ANINDA ABONE OLAN TUM kullanicilar (renewal ∪ cancel
// grubu, allT0Lookup) - SADECE cancel grubu degil. Eskiden bu fonksiyon
// sadece cancelT0Lookup uzerinde donuyordu, yani renewal grubu (cancel
// ETMEYENLER) histogramda HIC yer almiyordu - toplam hicbir zaman toplam
// abone sayisina ulasamiyordu. Simdi:
//   - cancel etmeyen (cancelUidSet'te olmayan) her kullanici 'no_cancel'
//     kovasina dusuyor,
//   - cancel eden herkes gun kovasina (ya da pencere disinda kaldiysa
//     "windowDays+1+" tasma kovasina) dusuyor,
//   - beklenmeyen durumlar (cancel zamani kayipsa ya da t0'dan ONCEYSE -
//     normalde olmamali ama sessizce atmak yerine ayri, gorunur bir kovaya
//     yaziliyor) da SAYILIYOR, hic kaybolmuyor.
function computeCancelActualDayDistribution(allT0Lookup, cancelUidSet, cancelTimeLookup, windowDays) {
  const counts = new Map();
  const bump = (k) => counts.set(k, (counts.get(k) || 0) + 1);

  for (const [uid, t0] of allT0Lookup.entries()) {
    if (!cancelUidSet.has(uid)) {
      bump('no_cancel'); // cancel etmedi (renewal oldu)
      continue;
    }
    const tCancel = cancelTimeLookup.get(uid);
    if (tCancel === undefined) { bump('anomaly_missing'); continue; } // savunma amacli - cancel grubunda olup zamani olmayan olmamali
    if (tCancel < t0) { bump('anomaly_before_t0'); continue; } // savunma amacli - cancel t0'dan once olmamali
    const dayNum = dayNumberUTC(tCancel, t0);
    const bucket = dayNum <= windowDays ? dayNum : `${windowDays + 1}+`;
    bump(bucket);
  }

  const totalCounted = [...counts.values()].reduce((a, b) => a + b, 0);
  const totalPopulation = allT0Lookup.size;
  counts.set('__total_population', totalPopulation);
  counts.set('__total_counted', totalCounted);
  if (totalCounted !== totalPopulation) {
    console.warn(`[Görsel 3] Histogram toplamı (${totalCounted}) popülasyon büyüklüğüne (${totalPopulation}) eşit değil — ${totalPopulation - totalCounted} kullanıcı kayboluyor. computeCancelActualDayDistribution içindeki kova mantığını kontrol et.`);
  }
  return counts;
}

function computeLastDayActiveDaysHistogram(t0Lookup, lastEventTime, activeDaysSet, windowDays) {
  const counts = new Map();
  for (const [uid, t0] of t0Lookup.entries()) {
    const lastT = lastEventTime.get(uid);
    if (lastT === undefined) continue;
    const day = Math.min(windowDays, dayNumberUTC(lastT, t0));
    if (day !== windowDays) continue;
    const nActive = (activeDaysSet.get(uid) || new Set()).size;
    if (nActive > 0) counts.set(nActive, (counts.get(nActive) || 0) + 1);
  }
  return counts;
}

// ---------------- render: stats ----------------

function renderStats(renewalCount, cancelCount, renewalTotal, cancelTotal) {
  els.statsSection.style.display = 'block';
  els.statRow.innerHTML = `
    <div class="stat-card renew">
      <div class="lbl">Renewal Grubu (filtreli)</div>
      <div class="val">${renewalCount.toLocaleString('tr-TR')}</div>
      <div class="sub">filtresiz toplam: ${renewalTotal.toLocaleString('tr-TR')}</div>
    </div>
    <div class="stat-card cancel">
      <div class="lbl">Cancel Grubu (filtreli)</div>
      <div class="val">${cancelCount.toLocaleString('tr-TR')}</div>
      <div class="sub">filtresiz toplam: ${cancelTotal.toLocaleString('tr-TR')}</div>
    </div>
  `;
}

// ---------------- render: visual 1 (Nx2, N=windowDays+1) ----------------

function renderVisual1(renewalAgg, cancelAgg, windowDays) {
  els.visual1.style.display = 'block';
  els.visual1Grid.innerHTML = '';

  const extraDay = windowDays + 1;
  const days = [...Array(windowDays).keys()].map((i) => i + 1).concat([extraDay]);
  const labels = days.map(String);
  const barColors = (base, light) => days.map((d) => (d === extraDay ? light : base));

  const renewCounts = days.map((d) => renewalAgg.dayBucketCounts.get(d) || 0);
  const cancelCounts = days.map((d) => cancelAgg.dayBucketCounts.get(d) || 0);
  // NOT: "|| 0" KULLANILMIYOR - median() gozlem yoksa null doner, bu null
  // deger oldugu gibi birakiliyor ki svgBarChart "hic veri yok" ile
  // "medyan gercekten 0" durumunu ayirt edebilsin (aksi halde ikisi de ayni
  // sifir-yukseklikli cubuk olarak gorunup birbirine karisiyordu).
  const renewCoins = days.map((d) => median(renewalAgg.dayBucketCoins.get(d)));
  const cancelCoins = days.map((d) => median(cancelAgg.dayBucketCoins.get(d)));
  const renewImages = days.map((d) => median(renewalAgg.dayBucketImages.get(d)));
  const cancelImages = days.map((d) => median(cancelAgg.dayBucketImages.get(d)));

  const sumMain = (arr) => arr.slice(0, windowDays).reduce((a, b) => a + b, 0);

  const c1 = makeChartCard(els.visual1Grid, 'Renewal Grubu', `n=${sumMain(renewCounts).toLocaleString('tr-TR')} · son event günü (UTC takvim günü)`,
    'Her çubuk, son aktivitesi o güne denk gelen kullanıcı sayısı. Yüksek çubuk = o gün çok kişi sessizleşmiş.');
  renderBar(c1, labels, renewCounts, barColors(PALETTE.renew, PALETTE.renewLight),
    { xLabel: 'Son aktivite günü', yLabel: 'Kullanıcı sayısı' });

  const c2 = makeChartCard(els.visual1Grid, 'Cancel Grubu', `n=${sumMain(cancelCounts).toLocaleString('tr-TR')} · son event günü (UTC takvim günü)`,
    'Aynı ölçüt, iptal grubu için. İki panelin şeklini karşılaştır — grup büyüklükleri farklı olduğu için yükseklikleri değil, dağılımın biçimini oku.');
  renderBar(c2, labels, cancelCounts, barColors(PALETTE.cancel, PALETTE.cancelLight),
    { xLabel: 'Son aktivite günü', yLabel: 'Kullanıcı sayısı' });

  const c3 = makeChartCard(els.visual1Grid, 'Renewal — Medyan Min Coin', 'pencere içindeki minimum coin',
    'O güne düşen kullanıcıların, hafta boyunca gördükleri EN DÜŞÜK coin bakiyesinin medyanı. Düşük değer = coin dibe vurmuş.');
  renderBar(c3, labels, renewCoins, barColors(PALETTE.renew, PALETTE.renewLight),
    { xLabel: 'Son aktivite günü', yLabel: 'Medyan min coin' });

  const c4 = makeChartCard(els.visual1Grid, 'Cancel — Medyan Min Coin', 'pencere içindeki minimum coin',
    'Aynı ölçüt, iptal grubu için. Soldaki panelden belirgin düşükse, coin tükenmesi iptalle ilişkili olabilir.');
  renderBar(c4, labels, cancelCoins, barColors(PALETTE.cancel, PALETTE.cancelLight),
    { xLabel: 'Son aktivite günü', yLabel: 'Medyan min coin' });

  const c5 = makeChartCard(els.visual1Grid, 'Renewal — Medyan Görsel Sayısı', 'image_generation_complete',
    'O güne düşen kullanıcıların hafta boyunca ürettiği görsel sayısının medyanı.');
  renderBar(c5, labels, renewImages, barColors(PALETTE.renew, PALETTE.renewLight),
    { xLabel: 'Son aktivite günü', yLabel: 'Medyan görsel' });

  const c6 = makeChartCard(els.visual1Grid, 'Cancel — Medyan Görsel Sayısı', 'image_generation_complete',
    'Aynı ölçüt, iptal grubu için. İki grup benzerse kullanım hacmi tek başına ayırt edici değil demektir.');
  renderBar(c6, labels, cancelImages, barColors(PALETTE.cancel, PALETTE.cancelLight),
    { xLabel: 'Son aktivite günü', yLabel: 'Medyan görsel' });
}

// ================= SAGKALIM / MODEL VERI HAZIRLIGI =================

// Her kullanici icin sagkalim gozlemi uretir:
//   CANCEL grubu  -> olay gerceklesti (event=1), zaman = cancel gunu
//   RENEWAL grubu -> SANSURLU (event=0), zaman = renewal gunu
// Bu, "abonelikte kalma suresi" egrisini verir. Renewal'i sansur saymak
// dogru olan: o kullanici o ana kadar iptal ETMEDI, sonrasi gozlem disi.
function buildSurvivalObs(renewalGroup, cancelGroup, cancelTimeLookup, windowDays) {
  const out = [];
  for (const [uid, g] of cancelGroup.entries()) {
    const tCancel = cancelTimeLookup.get(uid);
    if (tCancel === undefined) continue;
    const day = dayNumberUTC(tCancel, g.t0);
    if (day < 1) continue;
    out.push({ uid, time: Math.min(day, windowDays + 1), event: 1 });
  }
  for (const [uid, g] of renewalGroup.entries()) {
    const day = dayNumberUTC(g.tRenewal, g.t0);
    if (day < 1) continue;
    out.push({ uid, time: Math.min(day, windowDays + 1), event: 0 });
  }
  return out;
}

// Sagkalim gozlemlerini maruziyet grubuna gore ayirir (KM + log-rank icin)
function stratifySurvival(obs, genInfo) {
  const byKey = new Map(EXPOSURE_ORDER.map((k) => [k, []]));
  obs.forEach((o) => {
    byKey.get(classifyExposure(genInfo.get(o.uid))).push({ time: o.time, event: o.event });
  });
  return EXPOSURE_ORDER
    .map((k) => ({ key: k, label: EXPOSURE_LABEL[k].replace(/\n/g, ' '), obs: byKey.get(k) }))
    .filter((g) => g.obs.length > 0);
}

// Cok degiskenli lojistik regresyon: cancel grubuna dusme olasiligi.
// ONEMLI TASARIM KARARI - sadece GUN 1 olculeri kullaniliyor:
// renewal grubunun penceresi renewal aninda kesildigi icin, pencere geneli
// olculer (toplam gorsel, aktif gun sayisi) grup ile MEKANIK olarak
// iliskilidir - onlari modele koymak sahte etki uretir. Gun 1 ise herkeste
// tam olarak gozlemlenir, o yuzden karsilastirilabilir.
function fitCancelModel(renewalT0, cancelT0, genInfo, dayCoinRange) {
  const X = [], y = [];
  const names = ['İlk fail, sonra başardı (B1)', 'İlk fail, hiç başaramadı (B2)', 'Hiç deneme yok (C)',
    'Gün 1 kalan coin', 'Gün 1 harcanan coin'];

  const push = (uid, isCancel) => {
    const key = classifyExposure(genInfo.get(uid));
    const perDay = dayCoinRange.get(uid);
    const d1 = perDay ? perDay.get(1) : undefined;
    if (!d1) return; // gun 1 coin verisi yoksa modele giremez
    X.push([
      key === 'B1' ? 1 : 0,
      key === 'B2' ? 1 : 0,
      key === 'C' ? 1 : 0,
      d1.min,
      d1.max - d1.min,
    ]);
    y.push(isCancel ? 1 : 0);
  };

  for (const uid of renewalT0.keys()) push(uid, false);
  for (const uid of cancelT0.keys()) push(uid, true);

  if (X.length < 30) return { fit: null, n: X.length, reason: 'yetersiz gözlem' };
  const yesCount = y.reduce((a, b) => a + b, 0);
  if (yesCount === 0 || yesCount === y.length) return { fit: null, n: X.length, reason: 'sonuç değişkeni sabit' };

  const fit = logisticRegression(X, y, names);
  return { fit, n: X.length, reason: fit ? null : 'model yakınsamadı' };
}

// ---------------- render: visual 3 (cancel actual day) ----------------

function renderVisual3(cancelActualDay, windowDays) {
  els.visual3.style.display = 'block';
  els.visual3Holder.innerHTML = '';

  const extraLabel = `${windowDays + 1}+`;
  const dayKeys = [...Array(windowDays).keys()].map((i) => i + 1);

  // Beklenmedik (savunma amaçlı) kovalar: veri gerçekten temizse bunlar hep
  // 0 kalır ve grafikte hiç görünmez - ama bir gün gerçekleşirlerse
  // kullanıcıyı sessizce kaybetmek yerine görünür kılarlar.
  const anomalyDefs = [
    ['anomaly_before_t0', 'anomali (cancel t0 öncesi)'],
    ['anomaly_missing', 'anomali (cancel zamanı yok)'],
  ].filter(([key]) => (cancelActualDay.get(key) || 0) > 0);

  const keys = [...dayKeys, extraLabel, ...anomalyDefs.map(([key]) => key), 'no_cancel'];
  const labels = [...dayKeys.map(String), extraLabel, ...anomalyDefs.map(([, label]) => label), 'cancel etmedi (renewal)'];
  const values = keys.map((k) => cancelActualDay.get(k) || 0);
  const colors = keys.map((k) => (k === 'no_cancel' ? PALETTE.renew : (String(k).startsWith('anomaly_') ? PALETTE.cancelLight : PALETTE.cancel)));

  const holder = document.createElement('div');
  els.visual3Holder.appendChild(holder);
  renderBar(holder, labels, values, colors, { xLabel: 'Cancel olayının günü (ya da sonuç)', yLabel: 'Kullanıcı sayısı', rotateLabels: true, widthPerBar: 46 });

  const totalPopulation = cancelActualDay.get('__total_population') || 0;
  const totalCounted = cancelActualDay.get('__total_counted') || 0;
  const check = document.createElement('div');
  check.className = 'read-note';
  check.innerHTML = totalPopulation === totalCounted
    ? `<b>Doğrulama:</b> histogram toplamı (${totalCounted.toLocaleString('tr-TR')}) popülasyon büyüklüğüne (${totalPopulation.toLocaleString('tr-TR')}) eşit — hiçbir kullanıcı kaybolmadı.`
    : `<b>⚠ UYARI:</b> histogram toplamı (${totalCounted.toLocaleString('tr-TR')}) popülasyon büyüklüğünden (${totalPopulation.toLocaleString('tr-TR')}) farklı — ${(totalPopulation - totalCounted).toLocaleString('tr-TR')} kullanıcı sessizce kayboluyor, kod incelenmeli (bkz. konsol uyarısı).`;
  els.visual3Holder.appendChild(check);
}

// ---------------- render: visual 4 (son takvim gününde aktif gün sayısı) ----------------

function renderVisual4(renewalCounts, cancelCounts, windowDays) {
  els.visual4.style.display = 'block';
  els.visual4Grid.innerHTML = '';

  const days = [...Array(windowDays).keys()].map((i) => i + 1);
  const labels = days.map(String);
  const rVals = days.map((d) => renewalCounts.get(d) || 0);
  const cVals = days.map((d) => cancelCounts.get(d) || 0);

  const c1 = makeChartCard(els.visual4Grid, 'Renewal Grubu', `n=${rVals.reduce((a, b) => a + b, 0).toLocaleString('tr-TR')} · gün ${windowDays}'de son event`,
    `Sadece son güne düşenler. x=1 → tek gün aktif olup sessizleşmiş; x=${windowDays} → her gün kullanmış.`);
  renderBar(c1, labels, rVals, PALETTE.renew, { xLabel: 'Kaç ayrı günde aktif', yLabel: 'Kullanıcı sayısı' });

  const c2 = makeChartCard(els.visual4Grid, 'Cancel Grubu', `n=${cVals.reduce((a, b) => a + b, 0).toLocaleString('tr-TR')} · gün ${windowDays}'de son event`,
    'Aynı ölçüt, iptal grubu için. Sola yığılma "hiç bağlanamadan gitti", sağa yığılma "düzenli kullandı ama son günde ayrıldı" demektir.');
  renderBar(c2, labels, cVals, PALETTE.cancel, { xLabel: 'Kaç ayrı günde aktif', yLabel: 'Kullanıcı sayısı' });
}

// ---------------- render: ileri analiz sekmesi ----------------

const KM_COLORS = { A: PALETTE.renew, B1: '#b07d2a', B2: PALETTE.cancel, C: PALETTE.renewLight };

function renderAdvancedVisuals(strata, logRank, hazardRows, modelResult, windowDays) {
  // A1: Kaplan-Meier egrileri
  els.adv1Grid.innerHTML = '';
  const kmSeries = strata.map((g) => {
    const km = kaplanMeier(g.obs);
    return {
      label: `${g.label} (n=${g.obs.length.toLocaleString('tr-TR')}${km.median !== null ? `, medyan ${km.median}g` : ''})`,
      color: KM_COLORS[g.key] || PALETTE.text,
      points: km.points.map((p) => ({ x: p.t, y: p.s, lo: p.lo, hi: p.hi })),
    };
  });
  const lrText = logRank.df > 0
    ? `Log-rank: χ²(${logRank.df}) = ${logRank.chi2.toFixed(2)}, ${fmtP(logRank.p)}`
    : 'Log-rank hesaplanamadı';
  const a1 = makeChartCard(els.adv1Grid, 'Abonelikte kalma eğrisi (Kaplan-Meier)', `${lrText} · gölgeli alan %95 GA · renewal = sansürlü`,
    'Eğri DÜŞEN "hâlâ abone" oranıdır, iptal oranı değil. Gün 3\'te %60 → o güne kadar %40 iptal etmiş. Eğriler ne kadar ayrışıyorsa gruplar o kadar farklı.');
  renderLine(a1, kmSeries, { step: true, band: true, yMax: 1, yPct: true, xLabel: 'T0\'dan itibaren gün', yLabel: 'Hâlâ abone olma olasılığı' });

  // A2: gunluk hazard
  els.adv2Grid.innerHTML = '';
  const a2 = makeChartCard(els.adv2Grid, 'Günlük iptal hazardı', 'h(g) = o gün iptal edenler ÷ o günün başında hâlâ abone olanlar',
    'Birikimli değil KOŞULLU olasılık: "o sabah hâlâ aboneyken, o gün iptal etme şansı". Sivri gün = riskin yığıldığı gün; müdahale penceresi ondan bir-iki gün öncesidir.');
  renderLine(a2, [{
    label: 'Koşullu iptal olasılığı (%)',
    color: PALETTE.cancel,
    points: hazardRows.map((r) => ({ x: r.day, y: r.hazard })),
  }], { dots: true, xLabel: 'Gün', yLabel: 'O gün iptal etme olasılığı (%)' });
}

