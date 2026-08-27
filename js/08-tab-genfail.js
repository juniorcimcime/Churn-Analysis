// ================= GENERATION FAIL MARUZIYET ANALIZI =================

// aiSegment dropdown'u bu sekmede tanimli (index.html), tek degisiklik
// dinleyicisi burada kurulur.
function wireGenFailControls() {
  if (!els.aiSegment) return;
  els.aiSegment.addEventListener('change', () => {
    if (!state) return;
    state.aiSegment = els.aiSegment.value || 'all';
    try { runFilteredAnalysis(); } catch (err) { logLine('HATA: ' + err.message); console.error(err); }
  });
}
wireGenFailControls();

const EXPOSURE_ORDER = ['A', 'B1', 'B2', 'C'];
const EXPOSURE_LABEL = {
  A: 'İlk deneme\nbaşarılı',
  B1: 'İlk fail,\nsonra başardı',
  B2: 'İlk fail,\nhiç başaramadı',
  C: 'Hiç deneme\nyok',
};

// %95 Wilson skor guven araligi. Kucuk orneklemlerde normal yaklasim
// (p ± 1.96·√(p(1-p)/n)) bozulur - ozellikle p 0'a veya 1'e yakinken
// aralik sinirlarin disina tasar. Wilson bu durumlarda da tutarli kalir.
function classifyExposure(gen) {
  if (!gen || !gen.firstAttempt) return 'C';
  if (gen.firstAttempt.type === 'complete') return 'A';
  return gen.hasSuccess ? 'B1' : 'B2';
}

// Her maruziyet grubu icin CANCEL grubuna dusme orani (+ Wilson CI).
// Payda: o maruziyet grubundaki, renewal VEYA cancel grubuna atanmis userlar.
function computeExposureVsOutcome(renewalT0, cancelT0, genInfo) {
  const stats = new Map(EXPOSURE_ORDER.map((k) => [k, { total: 0, cancelled: 0 }]));
  const bump = (uid, isCancel) => {
    const key = classifyExposure(genInfo.get(uid));
    const s = stats.get(key);
    s.total++;
    if (isCancel) s.cancelled++;
  };
  for (const uid of renewalT0.keys()) bump(uid, false);
  for (const uid of cancelT0.keys()) bump(uid, true);

  return EXPOSURE_ORDER.map((key) => {
    const { total, cancelled } = stats.get(key);
    const ci = wilsonCI(cancelled, total);
    return { key, label: EXPOSURE_LABEL[key], total, cancelled, ...ci };
  });
}

// Gun 2'ye donus orani, maruziyet grubuna gore.
// SANSURLEME: gozlem penceresi gun 2 baslamadan biten userlar (ornegin
// renewal'i gun 1'de gerceklesenler) haric tutulur - onlar icin "gun 2'de
// dondu mu" sorusu OLCULEMEZ, "donmedi" saymak yanli sonuc verir.
function computeDay2ReturnByExposure(renewalGroup, cancelGroup, genInfo, activeDaysSet) {
  const stats = new Map(EXPOSURE_ORDER.map((k) => [k, { total: 0, returned: 0 }]));
  let censored = 0;

  const consider = (uid, t0, windowEnd) => {
    const day2Start = (Math.floor(t0 / SECONDS_PER_DAY) + 1) * SECONDS_PER_DAY;
    if (windowEnd <= day2Start) { censored++; return; } // gun 2 hic gozlemlenemedi
    const s = stats.get(classifyExposure(genInfo.get(uid)));
    s.total++;
    const days = activeDaysSet.get(uid);
    if (days && days.has(2)) s.returned++;
  };

  for (const [uid, g] of renewalGroup.entries()) consider(uid, g.t0, g.tRenewal);
  for (const [uid, g] of cancelGroup.entries()) consider(uid, g.t0, g.windowEnd);

  const points = EXPOSURE_ORDER.map((key) => {
    const { total, returned } = stats.get(key);
    const ci = wilsonCI(returned, total);
    return { key, label: EXPOSURE_LABEL[key], total, returned, ...ci };
  });
  return { points, censored };
}

// Son aktivite gunu dagilimi, maruziyet grubuna gore (yuzde olarak, cunku
// grup buyuklukleri cok farkli - ham sayi karsilastirilamaz).
function computeLastDayByExposure(t0Lookup, genInfo, lastEventTime, windowDays) {
  const perGroup = new Map(EXPOSURE_ORDER.map((k) => [k, new Map()]));
  const totals = new Map(EXPOSURE_ORDER.map((k) => [k, 0]));

  for (const [uid, t0] of t0Lookup.entries()) {
    const lastT = lastEventTime.get(uid);
    if (lastT === undefined) continue;
    const key = classifyExposure(genInfo.get(uid));
    const day = Math.min(windowDays, dayNumberUTC(lastT, t0));
    const m = perGroup.get(key);
    m.set(day, (m.get(day) || 0) + 1);
    totals.set(key, totals.get(key) + 1);
  }

  return EXPOSURE_ORDER.map((key) => {
    const total = totals.get(key);
    const counts = perGroup.get(key);
    const values = [];
    for (let d = 1; d <= windowDays; d++) {
      values.push(total > 0 ? ((counts.get(d) || 0) / total) * 100 : 0);
    }
    return { key, label: EXPOSURE_LABEL[key], total, values };
  });
}

// Cancel grubundaki, ilk denemesi FAIL olan (B1+B2) userlar icin:
// ilk fail ile cancel event'i arasinda gecen sure (gun cinsinden).
// Sure kisaysa (saatler icinde) nedensel bag daha inandirici olur.
function computeFailToCancelElapsed(cancelT0, genInfo, cancelTimeLookup) {
  const values = [];
  for (const uid of cancelT0.keys()) {
    const g = genInfo.get(uid);
    if (!g || !g.firstAttempt || g.firstAttempt.type !== 'failed') continue;
    const tCancel = cancelTimeLookup.get(uid);
    if (tCancel === undefined) continue;
    const elapsed = (tCancel - g.firstFailTime) / 3600; // SAAT (gun cok kaba kaliyordu)
    if (elapsed >= 0) values.push(elapsed);
  }
  return values;
}

// DOZ-YANIT: pencere icindeki toplam fail sayisina gore (0,1,2,3+) cancel
// orani. Monoton artiyorsa bulgu guclenir. UYARI: cok deneyen kullanicinin
// fail gorme olasiligi da yuksektir, yani bu grafik kullanim yogunluguyla
// KARISIK bir sinyal - "ilk deneme" grafigi bu sapmadan bagimsizdir.
// FAIL ORANI -> cancel orani. Ham fail sayisi kullanim yogunluguyla
// karisiktir; oran bu sapmayi giderir: 100 denemeden 5 fail ile 5 denemeden
// 5 fail cok farkli deneyimlerdir ama ham sayida ayni gorunurler.
function computeFailRatioResponse(renewalT0, cancelT0, genInfo, imageGenCount) {
  const buckets = [
    { key: 'deneme yok', test: (r) => r === null },
    { key: '0 (hiç fail yok)', test: (r) => r === 0 },
    { key: '0-10%', test: (r) => r > 0 && r <= 0.10 },
    { key: '10-25%', test: (r) => r > 0.10 && r <= 0.25 },
    { key: '25-50%', test: (r) => r > 0.25 && r <= 0.50 },
    { key: '50%+', test: (r) => r > 0.50 },
  ];
  const stats = new Map(buckets.map((b) => [b.key, { total: 0, cancelled: 0 }]));

  const ratioOf = (uid) => {
    const g = genInfo.get(uid);
    const fails = g ? g.failCount : 0;
    const oks = imageGenCount.get(uid) || 0;
    const tot = fails + oks;
    return tot === 0 ? null : fails / tot;
  };
  const bump = (uid, isCancel) => {
    const r = ratioOf(uid);
    const b = buckets.find((x) => x.test(r));
    if (!b) return;
    const s = stats.get(b.key);
    s.total++;
    if (isCancel) s.cancelled++;
  };
  for (const uid of renewalT0.keys()) bump(uid, false);
  for (const uid of cancelT0.keys()) bump(uid, true);

  return buckets.map((b) => {
    const { total, cancelled } = stats.get(b.key);
    return { key: b.key, label: b.key, total, cancelled, ...wilsonCI(cancelled, total) };
  }).filter((r) => r.total > 0);
}

function computeDoseResponse(renewalT0, cancelT0, genInfo) {
  const labels = ['0', '1', '2', '3+'];
  const stats = new Map(labels.map((k) => [k, { total: 0, cancelled: 0 }]));
  const bucketOf = (n) => (n >= 3 ? '3+' : String(n));

  const bump = (uid, isCancel) => {
    const g = genInfo.get(uid);
    const n = g ? g.failCount : 0;
    const s = stats.get(bucketOf(n));
    s.total++;
    if (isCancel) s.cancelled++;
  };
  for (const uid of renewalT0.keys()) bump(uid, false);
  for (const uid of cancelT0.keys()) bump(uid, true);

  return labels.map((key) => {
    const { total, cancelled } = stats.get(key);
    const ci = wilsonCI(cancelled, total);
    return { key, label: key, total, cancelled, ...ci };
  });
}

// ================= AI TYPE DAGILIMI =================

// Iki ayri dagilim: (a) pencere icindeki TUM failler, (b) yalnizca ILK
// denemesi fail olanlarin o ilk failinin turu. Ikincisi kullanici basina
// TEK gozlem oldugu icin kullanim yogunlugu sapmasindan aridir.
// Ilk hafta tablosu artik aiByUser'dan toplaniyor: yalnizca SECILI
// popülasyondaki (demografik filtre + AI segmenti uygulanmis) kullanicilarin
// pencere ici denemeleri sayilir. Onceden global sayaç kullaniliyordu ve
// filtre degistiginde sayilar sabit kaliyordu - yanilticiydi.
function computeAiTypeDistribution(aiByUser, genInfo, t0Lookup) {
  const agg = new Map();
  for (const uid of t0Lookup.keys()) {
    const per = aiByUser.get(uid);
    if (!per) continue;
    for (const [nm, v] of per.entries()) {
      let e = agg.get(nm);
      if (!e) { e = { fails: 0, oks: 0 }; agg.set(nm, e); }
      e.fails += v.fails; e.oks += v.oks;
    }
  }
  return computeAiTypeDistributionFrom(agg, genInfo, t0Lookup);
}

function computeAiTypeDistributionFrom(aiByType, genInfo, t0Lookup) {
  const all = [...aiByType.entries()].map(([name, v]) => ({
    name, fails: v.fails, oks: v.oks, total: v.fails + v.oks,
    failRate: (v.fails + v.oks) > 0 ? (v.fails / (v.fails + v.oks)) * 100 : 0,
  })).sort((a, b) => b.fails - a.fails);

  const firstMap = new Map(); // ai -> {fails, oks}
  for (const uid of t0Lookup.keys()) {
    const g = genInfo.get(uid);
    if (!g || !g.firstAttempt) continue;
    const ai = g.firstAttempt.ai || '(belirtilmemiş)';
    let e = firstMap.get(ai);
    if (!e) { e = { fails: 0, oks: 0 }; firstMap.set(ai, e); }
    if (g.firstAttempt.type === 'failed') e.fails++; else e.oks++;
  }
  const first = [...firstMap.entries()].map(([name, v]) => ({
    name, fails: v.fails, oks: v.oks, total: v.fails + v.oks,
    failRate: (v.fails + v.oks) > 0 ? (v.fails / (v.fails + v.oks)) * 100 : 0,
  })).sort((a, b) => b.fails - a.fails);

  // Fail YUZDESI'ne gore ayri siralama (ham sayidan farkli bir hikaye anlatir)
  const byRate = all.filter((x) => x.total > 0).slice().sort((a, b) => b.failRate - a.failRate);
  return { all, first, byRate };
}

// TUM ZAMANLAR AI type fail oranlari (grup/pencere kisiti yok)
function computeAiTypeAllTime(aiByTypeAll) {
  const rows = [...aiByTypeAll.entries()].map(([name, v]) => {
    const total = v.fails + v.oks;
    return { name, fails: v.fails, oks: v.oks, total, failRate: total > 0 ? (v.fails / total) * 100 : 0 };
  });
  const totalFails = rows.reduce((s, x) => s + x.fails, 0);
  const totalOks = rows.reduce((s, x) => s + x.oks, 0);
  const overall = (totalFails + totalOks) > 0 ? (totalFails / (totalFails + totalOks)) * 100 : 0;
  rows.forEach((r) => { r.failShare = totalFails > 0 ? (r.fails / totalFails) * 100 : 0; });
  rows.sort((a, b) => b.failRate - a.failRate);
  return { rows, totalFails, totalOks, overall };
}

// AI TYPE ZAMAN CIZELGESI: turler donemsel olarak yenilendigi icin, fail
// orani yuksek turlerin hangi tarihlerde kullanildigini ve ne zaman fail
// verdiğini gosterir. Yalnizca esigi asan turler alinir - aksi halde onlarca
// cizgi ust uste biner.
function computeAiTimeline(aiDaily, aiByType, minFailRatePct, minTotal, maxTypes = 15) {
  const selected = [...aiByType.entries()]
    .filter(([, v]) => {
      const tot = v.fails + v.oks;
      return tot >= minTotal && tot > 0 && (v.fails / tot) * 100 >= minFailRatePct;
    })
    .sort((a, b) => (b[1].fails + b[1].oks) - (a[1].fails + a[1].oks))
    .slice(0, maxTypes)
    .map(([name]) => name);

  if (selected.length === 0) return { types: [], usage: [], fails: [], minDay: 0, maxDay: 0 };

  let minDay = Infinity, maxDay = -Infinity;
  selected.forEach((nm) => {
    const dm = aiDaily.get(nm);
    if (!dm) return;
    for (const d of dm.keys()) { if (d < minDay) minDay = d; if (d > maxDay) maxDay = d; }
  });
  if (!Number.isFinite(minDay)) return { types: [], usage: [], fails: [], minDay: 0, maxDay: 0 };

  const usage = [], fails = [];
  selected.forEach((nm, i) => {
    const dm = aiDaily.get(nm) || new Map();
    const uPts = [], fPts = [];
    for (let d = minDay; d <= maxDay; d++) {
      const e = dm.get(d);
      uPts.push({ x: d, y: e ? e.fails + e.oks : 0 });
      fPts.push({ x: d, y: e ? e.fails : 0 });
    }
    const color = AI_COLORS[i % AI_COLORS.length];
    const v = aiByType.get(nm);
    const rate = ((v.fails / (v.fails + v.oks)) * 100).toFixed(0);
    usage.push({ label: `${nm} (%${rate} fail)`, color, points: uPts });
    fails.push({ label: `${nm} (%${rate} fail)`, color, points: fPts });
  });

  return { types: selected, usage, fails, minDay, maxDay };
}

const AI_COLORS = ['#762c1f', '#20463a', '#a3792e', '#4a6fa5', '#7d3f6b',
  '#2e7d74', '#a8604c', '#5c7d70', '#8a6d3b', '#556b8d'];

const dayIdxToDate = (d) => new Date(d * SECONDS_PER_DAY * 1000).toISOString().slice(5, 10);

// ================= AI TYPE SEGMENTI =================

// custom_image_edit / custom-image-edit turleri yapisal olarak daha fail'e
// yatkin oldugu icin diger turlerle birlikte degerlendirmek yaniltici olur.
// Kullanici, ILK generation denemesinin turune gore segmente atanir - boylece
// her analiz kendi icinde tutarli bir populasyon uzerinde calisir.
function normalizeAiName(s) {
  return String(s || '').toLowerCase().replace(/[-_\s]/g, '');
}

function aiSegmentOf(uid, genInfo, customSet) {
  const g = genInfo.get(uid);
  if (!g || !g.firstAttempt) return 'none';
  return customSet.has(normalizeAiName(g.firstAttempt.ai)) ? 'custom' : 'other';
}

// Segmente gore kullanici haritasini filtreler
function filterBySegment(t0Lookup, genInfo, customSet, segment) {
  if (segment === 'all') return t0Lookup;
  const out = new Map();
  for (const [uid, v] of t0Lookup.entries()) {
    if (aiSegmentOf(uid, genInfo, customSet) === segment) out.set(uid, v);
  }
  return out;
}

function filterGroupBySegment(group, genInfo, customSet, segment) {
  if (segment === 'all') return group;
  const out = new Map();
  for (const [uid, v] of group.entries()) {
    if (aiSegmentOf(uid, genInfo, customSet) === segment) out.set(uid, v);
  }
  return out;
}

function segmentSizes(t0Lookup, genInfo, customSet) {
  const s = { all: 0, custom: 0, other: 0, none: 0 };
  for (const uid of t0Lookup.keys()) {
    s.all++;
    s[aiSegmentOf(uid, genInfo, customSet)]++;
  }
  return s;
}

// ---------------- render: generation fail sekmesi ----------------

const EXPOSURE_COLORS = [PALETTE.renew, PALETTE.cancelLight, PALETTE.cancel, PALETTE.renewLight];

function renderGenFailVisuals(outcome, day2Return, lastDay, elapsed, dose, failRatio, windowDays) {
  // G1: cancel grubuna dusme orani, maruziyete gore
  els.gf1Grid.innerHTML = '';
  const g1 = makeChartCard(els.gf1Grid, 'Cancel grubuna düşme oranı', 'çubuklar: %95 Wilson güven aralığı',
    'Her çubuk bir maruziyet grubu; yükseklik o gruptaki iptal yüzdesi, altındaki n grup büyüklüğü. Dikey çizgiler güven aralığı — İKİ ÇUBUĞUN ARALIKLARI ÜST ÜSTE BİNİYORSA aradaki fark yorumlanamaz.');
  renderBarCI(g1, outcome, EXPOSURE_COLORS, { yLabel: 'Cancel grubuna düşme oranı (%)' });

  // G2: gun 2'ye donus orani
  els.gf2Grid.innerHTML = '';
  const censoredNote = day2Return.censored > 0
    ? `${day2Return.censored.toLocaleString('tr-TR')} kullanıcı hariç tutuldu (gün 2 hiç gözlemlenemedi)`
    : 'sansürlenen kullanıcı yok';
  const g2 = makeChartCard(els.gf2Grid, 'Gün 2\'ye dönüş oranı', censoredNote,
    'İptal resmi bir aksiyon; geri dönmemek daha erken bir terk sinyalidir. Yüksek çubuk = o grup ertesi gün geri gelmiş.');
  renderBarCI(g2, day2Return.points, EXPOSURE_COLORS, { yLabel: 'Gün 2\'de aktif olma oranı (%)' });

  // G3: son aktivite gunu dagilimi (her maruziyet grubu icin ayri panel).
  // "C" (hic deneme yok) grubu bu tab'in populasyonunda yapisal olarak
  // neredeyse hep bostur - abone olan bir kullanicinin hic uretim denemesi
  // olmamasi nadirdir, o yuzden bu panel gosterge degeri tasimiyor ve gosterilmiyor.
  els.gf3Grid.innerHTML = '';
  const dayLabels = [...Array(windowDays).keys()].map((i) => String(i + 1));
  lastDay.filter((series) => series.key !== 'C').forEach((series, i) => {
    const holder = makeChartCard(els.gf3Grid, series.label.replace(/\n/g, ' '), `n=${series.total.toLocaleString('tr-TR')}`,
      'Grup büyüklükleri çok farklı olduğu için ham sayı değil GRUP İÇİ YÜZDE gösteriliyor — paneller böylece karşılaştırılabilir. Sola yığılma erken sessizleşme demektir.');
    renderBar(holder, dayLabels, series.values.map((v) => Math.round(v * 10) / 10), EXPOSURE_COLORS[i],
      { xLabel: 'Son aktivite günü', yLabel: 'Grup içi oran (%)' });
  });

  // G4: ilk fail -> cancel arasi gecen sure
  els.gf4Grid.innerHTML = '';
  // İptaller çoğunlukla aynı gün gerçekleştiği için GÜN ölçeği neredeyse tek
  // çubuğa iniyordu; SAAT ölçeğinde 2 saatlik binlerle detay görünür oluyor.
  const elapCap = 72;
  const elapIn = elapsed.filter((v) => v <= elapCap);
  const elapCut = elapsed.length - elapIn.length;
  const g4 = makeChartCard(els.gf4Grid, 'İlk fail → cancel arası geçen süre',
    `n=${elapsed.length.toLocaleString('tr-TR')} · 2 saatlik dilimler · ${elapCap} saat üstü ${elapCut.toLocaleString('tr-TR')} kişi grafik dışı`,
    'Kütle ilk saatlerde toplanıyorsa fail ile iptal arasındaki bağ inandırıcıdır; süre günlere yayılıyorsa iptalin başka sebepleri ağır basıyor demektir. Grafiği yatay kaydırarak tüm dilimleri okuyabilirsin.');
  const eb = fixedWidthBins(elapIn, 2);
  renderBar(g4, eb.labels, eb.values, PALETTE.cancel,
    { widthPerBar: 46, xLabel: 'Fail\'den sonra geçen saat', yLabel: 'Kullanıcı sayısı' });
  if (elapsed.length > 0) {
    const within2h = elapsed.filter((v) => v <= 2).length;
    const pct2h = (within2h / elapsed.length) * 100;
    const note = document.createElement('div');
    note.className = 'read-note';
    note.innerHTML = `Cancel eden kullanıcıların <b>%${pct2h.toFixed(1)}'i</b> ilk fail'den sonraki 2 saat içinde iptal ediyor.`;
    g4.parentElement.appendChild(note);
  }

  // G5: doz-yanit
  els.gf5Grid.innerHTML = '';
  const g5 = makeChartCard(els.gf5Grid, 'Fail sayısına göre cancel oranı',
    'y ekseni: İLK HAFTA içinde cancel grubuna düşme oranı · çubuklar %95 GA',
    'Y ekseni, o gruptaki kullanıcıların yüzde kaçının <b>ilk hafta sonunda cancel grubunda</b> olduğunu gösterir (renewal\'dan önce iptal etmiş olanlar). Soldan sağa monoton yükseliş bulguyu güçlendirir. DİKKAT: çok deneyen kullanıcı fail de çok görür — bu grafik kullanım yoğunluğuyla karışık bir sinyal taşır, oran grafiği (yanda) bu sapmadan arındırır.');
  renderBarCI(g5, dose, PALETTE.cancel, { xLabel: 'Pencere içindeki toplam fail sayısı', yLabel: 'İlk hafta cancel oranı (%)' });

  // Fail ORANI (fail / toplam deneme): ham fail sayısındaki kullanım
  // yoğunluğu sapmasını ortadan kaldırır - çok deneyen de az deneyen de
  // aynı ölçekte karşılaştırılır.
  const g6 = makeChartCard(els.gf5Grid, 'Fail ORANINA göre cancel oranı',
    'fail ÷ (fail + başarılı üretim) · çubuklar %95 GA',
    'Ham fail sayısı yerine <b>başarısızlık oranı</b>. 100 denemeden 5\'i fail olan ile 5 denemeden 5\'i fail olan kullanıcı çok farklı deneyim yaşar; bu grafik ikisini ayırır ve kullanım yoğunluğu sapmasından arındırır.');
  renderBarCI(g6, failRatio, PALETTE.cancelLight, { xLabel: 'Fail oranı', yLabel: 'İlk hafta cancel oranı (%)' });
}

// Onceki-olaylar grafigi icin ayri yoksayma listesi (Gorsel 28).
// ---------------- render: AI type dagilimi ----------------

function renderAiTypes(ai, timeline, allTime) {
  els.gf6Grid.innerHTML = '';
  if (!ai || ai.all.length === 0) {
    els.gf6Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">AI type kolonu bulunamadı. Ayarlar panelinden kolon adını kontrol et (varsayılan: ai_type, model_type, generation_type, style_type).</div></div>';
    return;
  }
  const shortN = (n) => (n.length > 26 ? n.slice(0, 25) + '…' : n);

  // 1) TUM failler - ham sayi
  const a = ai.all.slice(0, 25);
  const h1 = makeChartCard(els.gf6Grid, 'TÜM failler — AI type dağılımı (ham sayı)',
    `KAPSAM: renewal/cancel grubu, 7 günlük gözlem penceresi · demografik filtre ve segment UYGULANIR · ${ai.all.length} tür · ${ai.all.reduce((s, x) => s + x.fails, 0).toLocaleString('tr-TR')} fail`,
    'Failler hangi üretim türünde yoğunlaşıyor. DİKKAT: bu ham sayıdır — çok kullanılan bir tür doğal olarak çok fail üretir. Hemen alttaki oran grafiği bu sapmayı giderir.');
  renderBar(h1, a.map((x) => shortN(x.name)), a.map((x) => x.fails), PALETTE.cancel,
    { widthPerBar: 52, rotateLabels: true, yLabel: 'Fail sayısı' });

  // 2) TUM failler - YUZDE (fail orani)
  const r = ai.byRate.slice(0, 25);
  const h2 = makeChartCard(els.gf6Grid, 'TÜM failler — AI type fail YÜZDESİ',
    'KAPSAM: renewal/cancel grubu, 7 günlük gözlem penceresi · demografik filtre ve segment UYGULANIR · fail ÷ (fail + başarılı) · en yüksek orandan sıralı',
    'Ham sayının aksine bu <b>karşılaştırılabilir</b> ölçüdür: az kullanılan ama sürekli patlayan bir tür burada öne çıkar, ham sayıda görünmezdi. Az denemeli türlerde oran oynak olur — alttaki tablodan toplam deneme sayısına da bak.');
  renderBar(h2, r.map((x) => shortN(x.name)), r.map((x) => Math.round(x.failRate * 10) / 10), PALETTE.brass || PALETTE.cancelLight,
    { widthPerBar: 52, rotateLabels: true, yLabel: 'Fail oranı (%)' });

  // 4) TAM tablo - fail 0 olanlar dahil HEPSI
  makeTableCard(els.gf6Grid, 'AI type — tüm türler',
    `KAPSAM: renewal/cancel grubu, 7 günlük gözlem penceresi · demografik filtre ve segment UYGULANIR · ${ai.all.length} türün tamamı (fail 0 olanlar dahil)`,
    [{ label: 'AI type' }, { label: 'Fail', num: true }, { label: 'Başarılı', num: true },
     { label: 'Toplam', num: true }, { label: 'Fail oranı', num: true }, { label: 'İlk denemede fail', num: true }],
    ai.all.map((x) => {
      const fr = ai.first.find((y) => y.name === x.name);
      const high = x.total >= 30 && x.failRate > 5;
      return [
        { v: x.name, cls: high ? 'sig' : '' },
        { v: x.fails.toLocaleString('tr-TR'), num: true },
        { v: x.oks.toLocaleString('tr-TR'), num: true },
        { v: x.total.toLocaleString('tr-TR'), num: true },
        { v: x.failRate.toFixed(1) + '%', num: true, cls: high ? 'sig' : (x.total < 30 ? 'muted' : '') },
        { v: fr ? fr.fails.toLocaleString('tr-TR') : '—', num: true },
      ];
    }), { searchable: true, searchPlaceholder: 'AI type ara…' });

  // 4b) TUM ZAMANLAR tablosu: kapsam farki acikca belirtilmis halde
  if (allTime && allTime.rows.length > 0) {
    makeTableCard(els.gf6Grid, 'AI type fail oranları — TÜM ZAMANLAR',
      'KAPSAM: dosyadaki TÜM generation olayları · grup üyeliği, gözlem penceresi ve demografik filtre UYGULANMAZ · ' +
      `${allTime.totalFails.toLocaleString('tr-TR')} fail / ${(allTime.totalFails + allTime.totalOks).toLocaleString('tr-TR')} deneme · genel fail oranı %${allTime.overall.toFixed(2)}`,
      [{ label: 'AI type' }, { label: 'Fail', num: true }, { label: 'Başarılı', num: true },
       { label: 'Toplam', num: true }, { label: 'Fail oranı', num: true }, { label: 'Tüm faillerin payı', num: true }],
      allTime.rows.map((x) => {
        const worse = x.total >= 100 && x.failRate > allTime.overall * 1.5;
        return [
          { v: x.name + (worse ? '  ★' : ''), cls: worse ? 'sig' : '' },
          { v: x.fails.toLocaleString('tr-TR'), num: true },
          { v: x.oks.toLocaleString('tr-TR'), num: true },
          { v: x.total.toLocaleString('tr-TR'), num: true },
          { v: x.failRate.toFixed(2) + '%', num: true, cls: worse ? 'sig' : (x.total < 100 ? 'muted' : '') },
          { v: x.failShare.toFixed(1) + '%', num: true },
        ];
      }), { searchable: true, searchPlaceholder: 'AI type ara…' });
  }

  // 5) ZAMAN CIZELGESI
  els.gf7Grid.innerHTML = '';
  if (!timeline || timeline.types.length === 0) {
    els.gf7Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Eşiği aşan AI type bulunamadı (fail oranı ≥ %5 ve yeterli deneme sayısı).</div></div>';
    return;
  }
  const spanDays = timeline.maxDay - timeline.minDay + 1;
  const minW = Math.max(700, spanDays * 12);

  const t1 = makeChartCard(els.gf7Grid, 'Fail oranı yüksek türler — hangi dönemlerde KULLANILDI',
    `KAPSAM: tüm zamanlar, tüm kullanıcılar · en çok kullanılan ${timeline.types.length} tür (üst sınır 15) · fail oranı ≥ %10 · ${spanDays} günlük aralık`,
    'Her renk bir AI type. Çizginin yükseldiği dönemler o türün aktif olduğu dönemlerdir; sıfıra indiği yerde tür kullanımdan kalkmış demektir. Türler dönemsel yenilendiği için eğriler birbirini takip eden dalgalar hâlinde görünür. Grafik yatay kaydırılabilir.');
  renderLine(t1, timeline.usage, {
    xLabel: 'Tarih (ay-gün)', yLabel: 'Günlük toplam deneme', dots: false, lineWidth: 1.2,
    xFormat: dayIdxToDate, rotateXTicks: true, maxXTicks: 20, minWidthPx: minW,
  });

  const t2 = makeChartCard(els.gf7Grid, 'Aynı türler — hangi dönemlerde FAIL verdi',
    'aynı renkler, aynı zaman ekseni',
    'Üstteki kullanım grafiğiyle karşılaştır. Bir tür kullanımda olduğu tüm dönem boyunca fail veriyorsa yapısal bir sorun; yalnızca belli bir aralıkta fail veriyorsa o döneme özgü bir arıza (sürüm hatası, sağlayıcı kesintisi) olabilir.');
  renderLine(t2, timeline.fails, {
    xLabel: 'Tarih (ay-gün)', yLabel: 'Günlük fail sayısı', dots: false, lineWidth: 1.2,
    xFormat: dayIdxToDate, rotateXTicks: true, maxXTicks: 20, minWidthPx: minW,
  });
}

