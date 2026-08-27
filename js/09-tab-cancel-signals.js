// ---------------- cancel sinyal sekmesi kontrolleri ----------------

// Event dropdown'larini pass1'de bulunan gercek event adlariyla doldurur.
function populateSignalControls(eventNameCounts) {
  // Alfabetik sirala (arananı bulmak kolay olsun) ama yanina sayiyi da yaz.
  // Frekans sirali kesif icin Gorsel 17'deki katalog tablosu var.
  const entries = [...eventNameCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  const fill = (sel, placeholder) => {
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      entries.map(([nm, n]) => `<option value="${escapeAttr(nm)}">${escapeXml(nm)} · ${n.toLocaleString('tr-TR')}</option>`).join('');
  };
  fill(els.csSignal, '— sinyal eventi seç —');
  fill(els.csF1, '— 1. adım —');
  fill(els.csF2, '— 2. adım —');
  fill(els.csF3, '— 3. adım (ops.) —');
  fill(els.csF4, '— 4. adım (ops.) —');
  fill(els.csC1, '— olay 1 —');
  fill(els.csC2, '— olay 2 —');
  fill(els.csC3, '— olay 3 (ops.) —');
  fill(els.csRiskEvent, '— olay seç —');
}

function wireSignalControls() {
  const rerun = () => {
    if (!state) return;
    try { runFilteredAnalysis(); } catch (err) { logLine('HATA: ' + err.message); console.error(err); }
  };
  if (els.csX) els.csX.addEventListener('change', () => {
    let n = parseInt(els.csX.value, 10);
    if (!Number.isFinite(n) || n < 2) n = 2;
    if (n > 100) n = 100;
    els.csX.value = n;
    if (state) state.csX = n;
    rerun();
  });
  if (els.csExclude) els.csExclude.addEventListener('change', () => {
    if (state) state.csExclude = els.csExclude.value;
    rerun();
  });
  if (els.csComboN) els.csComboN.addEventListener('change', () => {
    let n = parseInt(els.csComboN.value, 10);
    if (!Number.isFinite(n) || n < 2) n = 2;
    if (n > 200) n = 200;
    els.csComboN.value = n;
    if (state) state.csComboN = n;
    rerun();
  });
  [['csRiskEvents', 'csRiskEvents', 1, 500], ['csRiskMinutes', 'csRiskMinutes', 1, 10080],
   ['csDistEventBin', 'csDistEventBin', 1, 50], ['csDistEventCap', 'csDistEventCap', 5, 1000],
   ['csDistMinuteBin', 'csDistMinuteBin', 1, 240], ['csDistMinuteCap', 'csDistMinuteCap', 5, 20160],
   ['nsTopN', 'nsTopN', 3, 40], ['csPrecN', 'csPrecN', 1, 50], ['nsMinSpan', 'nsMinSpan', 0, 365], ['nsDayTopN', 'nsDayTopN', 3, 25]]
    .forEach(([elKey, stKey, lo, hi]) => {
      if (!els[elKey]) return;
      els[elKey].addEventListener('change', () => {
        let n = parseInt(els[elKey].value, 10);
        if (!Number.isFinite(n) || n < lo) n = lo;
        if (n > hi) n = hi;
        els[elKey].value = n;
        if (state) state[stKey] = n;
        rerun();
      });
    });
  [['csSignal', 'csSignal'], ['csF1', 'csF1'], ['csF2', 'csF2'], ['csF3', 'csF3'], ['csF4', 'csF4'],
   ['csC1', 'csC1'], ['csC2', 'csC2'], ['csC3', 'csC3'], ['csRiskEvent', 'csRiskEvent']]
    .forEach(([elKey, stateKey]) => {
      if (!els[elKey]) return;
      els[elKey].addEventListener('change', () => {
        if (state) state[stateKey] = els[elKey].value || null;
        rerun();
      });
    });
}
wireSignalControls();

// ================= CANCEL ONCESI SINYAL ANALIZLERI =================

// Diziyi en YENIDEN eskiye sirala + dislanan eventleri ayikla
function prepSeq(seq, excludeSet) {
  return [...seq].filter((e) => !excludeSet.has(e.ev)).sort((a, b) => b.t - a.t);
}

// [1] Event kesif tablosu: hangi eventler var, ne siklikta, kac kullanicida.
function computeEventCatalog(eventNameCounts, userEventInfo, totalUsers) {
  const userCounts = new Map();
  for (const em of userEventInfo.values()) {
    for (const nm of em.keys()) userCounts.set(nm, (userCounts.get(nm) || 0) + 1);
  }
  return [...eventNameCounts.entries()]
    .map(([name, count]) => ({
      name, count,
      users: userCounts.get(name) || 0,
      userPct: totalUsers > 0 ? ((userCounts.get(name) || 0) / totalUsers) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// [Teshis] Vaka penceresinin (son X event) GERCEK zaman genisligi + uygulama
// ici mudahalenin ERISIM TAVANI (iptalden once uygulamayi hic acmayanlar
// hicbir tetikleyiciyle yakalanamaz).
function computeWindowDiagnostics(preCancelSeq, cancelGroupSize, X, excludeSet) {
  const spansHours = [];
  let withAnyEvent = 0, enough = 0;
  for (const seq of preCancelSeq.values()) {
    const s = prepSeq(seq, excludeSet);
    if (s.length > 0) withAnyEvent++;
    if (s.length >= X) {
      enough++;
      spansHours.push((s[0].t - s[X - 1].t) / 3600);
    }
  }
  return {
    spansHours,
    medianSpanHours: median(spansHours),
    withAnyEvent,
    reachCeilingPct: cancelGroupSize > 0 ? (withAnyEvent / cancelGroupSize) * 100 : 0,
    enough,
    cancelGroupSize,
  };
}

// [2] Case-crossover + McNemar: her event icin, ayni kullanicinin
// VAKA penceresi (iptalden onceki son X event) ile KONTROL penceresi
// (ondan onceki X event) karsilastirilir. Kullanici kendi kontrolu oldugu
// icin ulke/cihaz/genel aktiflik gibi tum kisi-duzeyi karistiricilar duser.
function computeCaseCrossover(preCancelSeq, X, excludeSet, minPairs = 5) {
  const stats = new Map(); // ev -> {b, c, both}
  let eligible = 0, dropped = 0;

  for (const seq of preCancelSeq.values()) {
    const s = prepSeq(seq, excludeSet);
    if (s.length < 2 * X) { dropped++; continue; }
    eligible++;
    const caseW = new Set(s.slice(0, X).map((e) => e.ev));
    const ctrlW = new Set(s.slice(X, 2 * X).map((e) => e.ev));
    for (const nm of new Set([...caseW, ...ctrlW])) {
      if (!stats.has(nm)) stats.set(nm, { b: 0, c: 0, both: 0 });
      const st = stats.get(nm);
      const inCase = caseW.has(nm), inCtrl = ctrlW.has(nm);
      if (inCase && !inCtrl) st.b++;
      else if (!inCase && inCtrl) st.c++;
      else st.both++;
    }
  }

  const rows = [...stats.entries()]
    .map(([name, { b, c, both }]) => {
      const t = mcNemarTest(b, c);
      return { name, b, c, both, discordant: b + c, chi2: t.chi2, p: t.p, or: t.or };
    })
    .filter((r) => r.discordant >= minPairs)
    .sort((a, b) => {
      const oa = a.or === Infinity ? 1e9 : (a.or || 0);
      const ob = b.or === Infinity ? 1e9 : (b.or || 0);
      return ob - oa;
    });

  return { rows, eligible, dropped };
}

// [3] Ters funnel: iptalden geriye dogru 1., 2., 3... event'in tur dagilimi.
function computeReverseFunnel(preCancelSeq, depth, excludeSet, topN = 6) {
  const positions = [];
  for (let k = 0; k < depth; k++) {
    const counts = new Map();
    let total = 0;
    for (const seq of preCancelSeq.values()) {
      const s = prepSeq(seq, excludeSet);
      if (s.length <= k) continue;
      counts.set(s[k].ev, (counts.get(s[k].ev) || 0) + 1);
      total++;
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
      .map(([name, n]) => ({ name, n, pct: total > 0 ? (n / total) * 100 : 0 }));
    positions.push({ position: k + 1, total, top });
  }
  return positions;
}

// [4] Kullanici tanimli funnel: adimlar ILK GORULME zamanina gore sirali
// tamamlanmis sayilir. Cancel ve renewal grubu ayri ayri hesaplanir.
function computeFunnel(steps, t0Lookup, userEventInfo) {
  const valid = steps.filter(Boolean);
  if (valid.length === 0) return [];
  const totals = new Array(valid.length).fill(0);
  const denom = t0Lookup.size;

  for (const uid of t0Lookup.keys()) {
    const em = userEventInfo.get(uid);
    if (!em) continue;
    let prevT = -Infinity;
    for (let i = 0; i < valid.length; i++) {
      const rec = em.get(valid[i]);
      if (!rec || rec.first < prevT) break; // sirali degil -> funnel burada kesilir
      totals[i]++;
      prevT = rec.first;
    }
  }
  return valid.map((name, i) => ({
    name, count: totals[i],
    pct: denom > 0 ? (totals[i] / denom) * 100 : 0,
    stepPct: i === 0 ? 100 : (totals[i - 1] > 0 ? (totals[i] / totals[i - 1]) * 100 : 0),
  }));
}

// [5] Sinyalden iptale gecen sure (saat) - Kaplan-Meier gozlemleri.
// Event'i yapip iptal etmeyenler SANSURLU (pencere sonuna kadar takip).
function buildSignalToCancelObs(eventName, renewalGroup, cancelGroup, cancelTimeLookup, userEventInfo) {
  const obs = [];
  const add = (uid, t0, endT, isCancel, cancelT) => {
    const em = userEventInfo.get(uid);
    const rec = em ? em.get(eventName) : undefined;
    if (!rec) return;
    const start = rec.first;
    if (isCancel) {
      const h = (cancelT - start) / 3600;
      if (h >= 0) obs.push({ time: h, event: 1 });
    } else {
      const h = (endT - start) / 3600;
      if (h >= 0) obs.push({ time: h, event: 0 });
    }
  };
  for (const [uid, g] of cancelGroup.entries()) {
    const tc = cancelTimeLookup.get(uid);
    if (tc === undefined) continue;
    add(uid, g.t0, g.windowEnd, true, tc);
  }
  for (const [uid, g] of renewalGroup.entries()) add(uid, g.t0, g.tRenewal, false, null);
  return obs;
}

// [6] Tetikleyicinin kestirim gucu: event'i yapanlarda vs yapmayanlarda
// cancel orani + 24 saat icinde iptal icin precision/recall.
// Lift yuksek olsa bile taban oran dusukse tetikleyici pratikte ise yaramaz;
// bu yuzden "bosuna rahatsiz edilen kisi sayisi" da raporlaniyor.
function computeTriggerPerformance(eventName, renewalT0, cancelT0, cancelTimeLookup, userEventInfo, horizonHours = 24) {
  let didAndCancel = 0, didNotAndCancel = 0, did = 0, didNot = 0;
  let firedAndCancelledInHorizon = 0;
  const totalCancels = cancelT0.size;

  const seen = (uid) => {
    const em = userEventInfo.get(uid);
    return em ? em.get(eventName) : undefined;
  };

  for (const uid of renewalT0.keys()) {
    if (seen(uid)) did++; else didNot++;
  }
  for (const uid of cancelT0.keys()) {
    const rec = seen(uid);
    if (rec) {
      did++; didAndCancel++;
      const tc = cancelTimeLookup.get(uid);
      if (tc !== undefined && tc >= rec.last && (tc - rec.last) / 3600 <= horizonHours) firedAndCancelledInHorizon++;
    } else { didNot++; didNotAndCancel++; }
  }

  const rateDid = did > 0 ? (didAndCancel / did) * 100 : 0;
  const rateNot = didNot > 0 ? (didNotAndCancel / didNot) * 100 : 0;
  return {
    did, didNot, didAndCancel, didNotAndCancel,
    rateDid, rateNot,
    lift: rateNot > 0 ? rateDid / rateNot : null,
    precision: did > 0 ? (firedAndCancelledInHorizon / did) * 100 : 0,
    recall: totalCancels > 0 ? (firedAndCancelledInHorizon / totalCancels) * 100 : 0,
    falseAlarms: did - firedAndCancelledInHorizon,
    horizonHours,
  };
}

// [6b] TERS YON: computeTriggerPerformance "olayi yapanlarin yuzde kaci
// t0'dan SONRA cancel grubuna dusuyor" sorar. Burada t0 cancel/renewal
// ANI kabul edilip GERIYE doğru windowDays gun icinde olay var mi bakilir.
// Ayni cift (yapmis/yapmamis) ve ayni pencere (cfg.windowDays), yon ters.
function computeReverseTriggerPerformance(eventName, renewalT0, cancelT0, cancelTimeLookup, userEventInfo, windowDays) {
  const windowSec = windowDays * 24 * 3600;

  const didBefore = (uid, anchor) => {
    const em = userEventInfo.get(uid);
    const rec = em ? em.get(eventName) : undefined;
    if (!rec) return false;
    return rec.last <= anchor && (anchor - rec.last) <= windowSec;
  };

  let cancelDid = 0, cancelDidNot = 0;
  for (const uid of cancelT0.keys()) {
    const tc = cancelTimeLookup.get(uid);
    if (tc === undefined) continue;
    if (didBefore(uid, tc)) cancelDid++; else cancelDidNot++;
  }

  let renewalDid = 0, renewalDidNot = 0;
  for (const [uid, g] of renewalT0.entries()) {
    if (didBefore(uid, g.tRenewal)) renewalDid++; else renewalDidNot++;
  }

  const cancelTotal = cancelDid + cancelDidNot;
  const renewalTotal = renewalDid + renewalDidNot;
  const rateCancel = cancelTotal > 0 ? (cancelDid / cancelTotal) * 100 : 0;
  const rateRenewal = renewalTotal > 0 ? (renewalDid / renewalTotal) * 100 : 0;
  return {
    cancelDid, cancelDidNot, cancelTotal, renewalDid, renewalDidNot, renewalTotal,
    rateCancel, rateRenewal,
    lift: rateRenewal > 0 ? rateCancel / rateRenewal : null,
    windowDays,
  };
}

// ---------------- render: cancel öncesi sinyal sekmesi ----------------

function fmtOR(or) {
  if (or === null) return '—';
  if (or === Infinity) return '∞';
  return or.toFixed(2);
}

function renderCancelSignals(ctx) {
  const { catalog, diag, crossover, funnelCancel, funnelRenewal, signalKM, trigger, reverseTrigger, signalEvent, X } = ctx;

  // [1] Event kesif tablosu
  els.cs1Grid.innerHTML = '';
  // Analitik olarak kritik olaylar hacimce dusuk olsa bile listenin BASINA
  // alinir ve vurgulanir - aksi halde yuzlerce satir arasinda kaybolurlar.
  const KEY_EVENTS = ['settings_button_clicked', 'rate_app_click', 'contact_us_click', 'paywall_contact_us_click'];
  const isKey = (nm) => KEY_EVENTS.some((k) => nm === k || nm.includes(k));
  const keyRows = catalog.filter((r) => isKey(r.name));
  const restRows = catalog.filter((r) => !isKey(r.name));
  const orderedCatalog = [...keyRows, ...restRows];
  makeTableCard(els.cs1Grid, 'Event kataloğu',
    `KAPSAM: dosyadaki TÜM satırlar, TÜM kullanıcılar, pencere kısıtı YOK · ${catalog.length} farklı event · ★ = analiz için kritik olaylar`,
    [{ label: 'Event' }, { label: 'Toplam', num: true }, { label: 'Kullanıcı', num: true }, { label: 'Kullanıcı %', num: true }],
    orderedCatalog.map((r) => {
      const k = isKey(r.name);
      return [
        { v: r.name + (k ? '  ★' : ''), cls: k ? 'sig' : '' },
        { v: r.count.toLocaleString('tr-TR'), num: true, cls: k ? 'sig' : '' },
        { v: r.users ? r.users.toLocaleString('tr-TR') : '—', num: true, cls: k ? 'sig' : '' },
        { v: r.users ? r.userPct.toFixed(1) + '%' : '—', num: true, cls: k ? 'sig' : '' },
      ];
    }));

  // [Teshis] vaka penceresinin gercek zaman genisligi
  els.cs2Grid.innerHTML = '';
  const spanCap = 48;
  const spanIn = diag.spansHours.filter((v) => v <= spanCap);
  const spanCut = diag.spansHours.length - spanIn.length;
  const spanCard = makeChartCard(els.cs2Grid, `Vaka penceresinin gerçek zaman genişliği (son ${X} olay)`,
    `medyan ${diag.medianSpanHours !== null ? diag.medianSpanHours.toFixed(1) + ' saat' : '—'} · ${diag.enough.toLocaleString('tr-TR')} kullanıcıda ${X} olay var · yarım saatlik dilimler · ${spanCap} saat üstü ${spanCut.toLocaleString('tr-TR')} kişi grafik dışı`,
    `Son ${X} olayın kaç saate yayıldığı. Medyan saatler mertebesindeyse "iptalden hemen önce" çerçevesi ayakta; günlere yayılıyorsa X'i düşür. Grafiği yatay kaydırarak tüm dilimleri tek tek okuyabilirsin.`);
  const spanBins = fixedWidthBins(spanIn, 0.5);
  renderBar(spanCard, spanBins.labels, spanBins.values, PALETTE.brass || PALETTE.cancelLight,
    { widthPerBar: 46, xLabel: 'Pencere genişliği (saat)', yLabel: 'Kullanıcı sayısı' });

  // [2] Case-crossover (KONTROL KOLLU)
  els.cs3Grid.innerHTML = '';
  const cc = crossover;
  const corrNote = cc.renewalArm.eligible === 0
    ? 'UYARI: yenileme kolunda yeterli veri yok — düzeltme yapılamadı, yalnızca ham OR gösteriliyor'
    : `iptal kolu ${cc.cancelArm.eligible.toLocaleString('tr-TR')} kişi · yenileme kolu ${cc.renewalArm.eligible.toLocaleString('tr-TR')} kişi · düşen: ${(cc.cancelArm.dropped + cc.renewalArm.dropped).toLocaleString('tr-TR')}`;
  makeTableCard(els.cs3Grid, 'Öncü sinyal sıralaması (kontrol kollu case-crossover)', corrNote,
    [{ label: 'Event' }, { label: 'b', num: true }, { label: 'c', num: true },
     { label: 'İptal OR', num: true }, { label: 'Yenileme OR', num: true },
     { label: 'Düzeltilmiş OR', num: true }, { label: 'p', num: true }],
    (() => {
      // Guclu sinyal olcutu: b>100, ham OR>3, duzeltilmis OR>3, p<0.001.
      // Bunlar listenin basina alinir ve vurgulanir.
      const strong = (r) => r.b > 100 && r.orCancel !== null && r.orCancel > 3
        && r.orAdj !== null && r.orAdj > 3 && r.p < 0.001;
      const hi = cc.rows.filter(strong);
      const lo = cc.rows.filter((r) => !strong(r));
      return [...hi, ...lo].slice(0, 40).map((r) => {
        const s = strong(r);
        return [
      { v: r.name + (s ? '  ★' : ''), cls: s ? 'sig' : '' },
      { v: r.b.toLocaleString('tr-TR'), num: true, cls: s ? 'sig' : '' },
      { v: r.c.toLocaleString('tr-TR'), num: true },
      { v: r.orCancel === null ? '—' : r.orCancel.toFixed(2), num: true, cls: s ? 'sig' : '' },
      { v: r.orRenewal === null ? '—' : r.orRenewal.toFixed(2), num: true, cls: r.weakCorrection ? 'muted' : '' },
      { v: r.orAdj === null ? 'hesaplanamadı' : r.orAdj.toFixed(2), num: true, cls: s ? 'sig' : (r.weakCorrection ? 'muted' : '') },
      { v: r.p < 0.001 ? '<0.001' : r.p.toFixed(3), num: true, cls: r.p < 0.05 ? 'sig' : 'muted' },
        ];
      });
    })());


  // [4] Kullanici tanimli funnel
  els.cs5Grid.innerHTML = '';
  if (funnelCancel.length === 0) {
    els.cs5Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Yukarıdan en az bir adım seç.</div></div>';
  } else {
    const holder = makeChartCard(els.cs5Grid, 'Funnel: cancel vs renewal',
      'adımlar ilk görülme zamanına göre sıralı sayılır',
      'Y ekseni GRUBUN TAMAMINA orandır (bir önceki adıma değil). İki eğri arasındaki açıklık, o yolun iptal niyetine özgü olup olmadığını gösterir. Adımdan adıma geçiş oranı için alttaki tabloya bak.');
    renderLine(holder, [
      { label: 'Cancel grubu', color: PALETTE.cancel, points: funnelCancel.map((s, i) => ({ x: i + 1, y: s.pct })) },
      { label: 'Renewal grubu', color: PALETTE.renew, points: funnelRenewal.map((s, i) => ({ x: i + 1, y: s.pct })) },
    ], { dots: true, yMax: 100, xLabel: 'Funnel adımı', yLabel: 'Grup içi oran (%)' });

    makeTableCard(els.cs5Grid, 'Adım adım döküm', 'stepPct = bir önceki adımdan devam edenlerin oranı',
      [{ label: 'Adım' }, { label: 'Cancel n', num: true }, { label: 'Cancel %', num: true },
       { label: 'Renewal n', num: true }, { label: 'Renewal %', num: true }],
      funnelCancel.map((s, i) => [
        `${i + 1}. ${s.name}`,
        { v: s.count.toLocaleString('tr-TR'), num: true },
        { v: s.pct.toFixed(1) + '%', num: true },
        { v: (funnelRenewal[i] ? funnelRenewal[i].count.toLocaleString('tr-TR') : '—'), num: true },
        { v: (funnelRenewal[i] ? funnelRenewal[i].pct.toFixed(1) + '%' : '—'), num: true },
      ]));
  }

  // [5] Sinyalden iptale sure (KM) + FILTRESIZ KARSILASTIRMA
  els.cs6Grid.innerHTML = '';
  if (!signalEvent || !signalKM || signalKM.all.length === 0) {
    els.cs6Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Sinyal eventi seç.</div></div>';
  } else {
    const kmSig = kaplanMeier(signalKM.signal);
    const kmAll = kaplanMeier(signalKM.all);
    const lr = logRankTest([
      { label: 'sinyal', obs: signalKM.signal },
      { label: 'tümü', obs: signalKM.all },
    ]);
    const medNote = signalKM.medianSignalToCancelH !== null
      ? `sinyalden iptale medyan ${signalKM.medianSignalToCancelH.toFixed(1)} saat`
      : 'sinyalden iptale medyan hesaplanamadı';
    // Y ekseni BIRIKIMLI IPTAL olasiligi (1 - S(t)). Sagkalim yonu yerine
    // dogrudan "cancel etme olasiligi" gosteriliyor - okumasi daha kolay.
    const toRisk = (pts) => pts.filter((p) => p.t <= 14)
      .map((p) => ({ x: p.t, y: (1 - p.s) * 100, lo: (1 - p.hi) * 100, hi: (1 - p.lo) * 100 }));
    const holder = makeChartCard(els.cs6Grid, `"${signalEvent}" yapanlar vs tüm kullanıcılar`,
      `${medNote} · log-rank ${fmtP(lr.p)} · her iki eğri de T0'dan (satın alma) başlar`,
      'Eğri YÜKSELEN birikimli iptal olasılığıdır. Gün 3\'te %80 → o kullanıcıların %80\'i o güne kadar iptal etmiş. Kırmızı eğri grinin ne kadar ÜSTÜNDEyse sinyal o kadar güçlü. Grafik ilk 14 günle sınırlı; sonrası çok az kişiyi temsil eder.');
    renderLine(holder, [
      { label: `Sinyali yapanlar (n=${signalKM.signal.length.toLocaleString('tr-TR')})`, color: PALETTE.cancel,
        points: toRisk(kmSig.points) },
      { label: `Tüm kullanıcılar (n=${signalKM.all.length.toLocaleString('tr-TR')})`, color: PALETTE.textDim,
        points: toRisk(kmAll.points) },
    ], { step: true, band: true, yMax: 100, xLabel: "T0'dan itibaren gün", yLabel: 'O hafta cancel etme olasılığı (%)' });
  }

  // [6] Tetikleyici kestirim gucu
  els.cs7Grid.innerHTML = '';
  if (!signalEvent) {
    els.cs7Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Sinyal eventi seç.</div></div>';
  } else {
    const t = trigger;
    const cmp = [
      { key: 'did', label: `"${signalEvent}"\nyapanlar`, total: t.did, ...wilsonCI(t.didAndCancel, t.did) },
      { key: 'not', label: 'yapmayanlar', total: t.didNot, ...wilsonCI(t.didNotAndCancel, t.didNot) },
    ];
    const holder = makeChartCard(els.cs7Grid, 'Cancel oranı karşılaştırması',
      `lift = ${t.lift !== null ? t.lift.toFixed(2) + '×' : '—'} · çubuklar %95 Wilson GA`,
      'Sol çubuk olayı yapanların, sağ çubuk yapmayanların iptal oranı. Buradaki "iptal", <b>ilk hafta (7 günlük gözlem penceresi) içinde cancel grubuna düşmüş olmak</b> demektir — 24 saatlik bir ufuk değil. Aradaki fark ne kadar büyükse sinyal o kadar güçlü; taban oran zaten yüksekse mutlak farka değil lift değerine bak.');
    renderBarCI(holder, cmp, [PALETTE.cancel, PALETTE.renew], { yLabel: 'Cancel oranı (%)' });

  }

  // [6b] Tetikleyici kestirim gucu - TERS YON
  els.cs7RevGrid.innerHTML = '';
  if (!signalEvent) {
    els.cs7RevGrid.innerHTML = '<div class="chart-card"><div class="chart-sub">Sinyal eventi seç.</div></div>';
  } else {
    const rt = reverseTrigger;
    const cmpRev = [
      { key: 'cancel', label: 'Cancel\nedenler', total: rt.cancelTotal, ...wilsonCI(rt.cancelDid, rt.cancelTotal) },
      { key: 'renewal', label: 'Renewal\nedenler', total: rt.renewalTotal, ...wilsonCI(rt.renewalDid, rt.renewalTotal) },
    ];
    const holderRev = makeChartCard(els.cs7RevGrid, `Ters yönlü: öncesinde "${signalEvent}" var mıydı`,
      `lift = ${rt.lift !== null ? rt.lift.toFixed(2) + '×' : '—'} · çubuklar %95 Wilson GA`,
      `Sol çubuk cancel edenlerin, sağ çubuk renewal edenlerin, kendi anlarından (cancel/renewal) geriye ${rt.windowDays} gün içinde "${signalEvent}" eventini yapmış olma oranı. Görsel 23'ün tersi: burada olay, sonuçtan (cancel) ÖNCE aranıyor.`);
    renderBarCI(holderRev, cmpRev, [PALETTE.cancel, PALETTE.renew], { yLabel: `Önceki ${rt.windowDays} gün içinde yapmış olma (%)` });
  }
}

// ---------------- render: sinyal sonrasi iptal riski ----------------

function renderPostSignalRisk(risk, signalEvent, maxEvents, maxMinutes) {
  els.cs9Grid.innerHTML = '';
  if (!signalEvent || !risk || risk.nUsers === 0) {
    els.cs9Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Yukarıdan bir olay seç.</div></div>';
    return;
  }
  const kmE = kaplanMeier(risk.eventObs);
  const kmT = kaplanMeier(risk.timeObs);
  const ptsE = toCumulativeRisk(kmE, maxEvents);
  const ptsT = toCumulativeRisk(kmT, maxMinutes);

  const atE = ptsE.length ? ptsE[ptsE.length - 1].y : 0;
  const atT = ptsT.length ? ptsT[ptsT.length - 1].y : 0;

  const h1 = makeChartCard(els.cs9Grid, `"${signalEvent}" sonrası — OLAY ölçeği`,
    `n=${risk.nUsers.toLocaleString('tr-TR')} kullanıcı · ${maxEvents} olay içinde iptal: %${atE.toFixed(1)}`,
    `Eğri YÜKSELEN birikimli iptal olasılığıdır. x=${maxEvents} noktasındaki değer: "olayı yaptıktan sonra ${maxEvents} olay geçmeden iptal etme olasılığı". İptal etmeyenler sansürlü olarak doğru şekilde paydada tutuluyor.`);
  renderLine(h1, [{ label: 'Birikimli iptal olasılığı', color: PALETTE.cancel, points: ptsE }],
    { step: true, band: true, yMax: 100, xLabel: 'Sinyalden sonra geçen olay sayısı', yLabel: 'Birikimli iptal olasılığı (%)' });

  const h2 = makeChartCard(els.cs9Grid, `"${signalEvent}" sonrası — SÜRE ölçeği`,
    `n=${risk.nUsers.toLocaleString('tr-TR')} kullanıcı · ${maxMinutes} dk içinde iptal: %${atT.toFixed(1)}`,
    `Aynı hesap dakika ölçeğinde. Eğri ilk dakikalarda dikeyse karar zaten verilmiş demektir ve push bildirimi yetişmez — ancak kullanıcı hâlâ ekrandayken uygulama içi müdahale iş görür.`);
  renderLine(h2, [{ label: 'Birikimli iptal olasılığı', color: PALETTE.brass || PALETTE.cancelLight, points: ptsT }],
    { step: true, band: true, yMax: 100, xLabel: 'Sinyalden sonra geçen dakika', yLabel: 'Birikimli iptal olasılığı (%)' });
}

// ---------------- render: sinyal sonrasi dagilim (pencere secimi) ----------------

function renderPostSignalDistribution(dist, signalEvent, cfgD) {
  els.cs10Grid.innerHTML = '';
  if (!signalEvent || !dist || dist.n === 0) {
    els.cs10Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Görsel 25\'teki olay seçicisini kullan.</div></div>';
    return;
  }

  const fmtM = (v) => {
    if (v === null) return '—';
    if (v < 90) return `${Math.round(v)} dk`;
    if (v < 1440) return `${(v / 60).toFixed(1)} saat`;
    return `${(v / 1440).toFixed(1)} gün`;
  };

  // ---- OLAY olcegi: sabit bin genisligi + kirpma + kaydirma ----
  const eW = cfgD.eventBin, eCap = cfgD.eventCap;
  const eIn = dist.eventVals.filter((v) => v <= eCap);
  const eCut = dist.eventVals.length - eIn.length;
  const eb = fixedWidthBins(eIn, eW);
  const h1 = makeChartCard(els.cs10Grid, 'Kaç OLAY sonra iptal etti',
    `n=${dist.n.toLocaleString('tr-TR')} · bin ${eW} olay · ${eCap} üstü ${eCut.toLocaleString('tr-TR')} kişi grafik dışı (tabloda var)`,
    'Her çubuk bir aralık. Grafiği yatay kaydırarak tüm aralıkları tek tek okuyabilirsin. Hangi pencerenin daha mantıklı olduğu için alttaki <b>kapsama tablosuna</b> bak — histogram şekli gösterir, tablo kararı verir.');
  renderBar(h1, eb.labels, eb.values, PALETTE.cancel,
    { widthPerBar: 46, xLabel: 'Sinyalden sonra geçen olay sayısı', yLabel: 'Kullanıcı sayısı' });

  // ---- SURE olcegi: 5 dk bin varsayilan ----
  const mW = cfgD.minuteBin, mCap = cfgD.minuteCap;
  const mIn = dist.minuteVals.filter((v) => v <= mCap);
  const mCut = dist.minuteVals.length - mIn.length;
  const mb = fixedWidthBins(mIn, mW);
  const h2 = makeChartCard(els.cs10Grid, 'Kaç DAKİKA sonra iptal etti',
    `n=${dist.n.toLocaleString('tr-TR')} · bin ${mW} dk · ${mCap} dk üstü ${mCut.toLocaleString('tr-TR')} kişi grafik dışı`,
    'Aynı dağılım süre ölçeğinde. Kütle ilk bin\'de yığılıyorsa karar sinyalle neredeyse eşzamanlı verilmiş demektir — bu durumda ters nedensellik şüphesi de artar.');
  renderBar(h2, mb.labels, mb.values, PALETTE.brass || PALETTE.cancelLight,
    { widthPerBar: 46, xLabel: 'Sinyalden sonra geçen dakika', yLabel: 'Kullanıcı sayısı' });

  // ---- KAPSAMA TABLOSU: asil karar buradan ----
  const evCand = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50, 75, 100];
  const evRows = computeCoverageTable(dist.eventVals, evCand);
  makeTableCard(els.cs10Grid, 'Pencere kararı — OLAY ölçeği',
    'ek kazancın belirgin düştüğü satır "dirsek" olarak işaretli — optimum genelde oradadır',
    [{ label: 'Pencere' }, { label: 'Kapsanan iptal', num: true }, { label: 'Kapsam', num: true }, { label: 'Ek kazanç', num: true }],
    evRows.map((r) => [
      { v: `${r.window} olay` + (r.elbow ? '  ◀ dirsek' : ''), cls: r.elbow ? 'sig' : '' },
      { v: r.covered.toLocaleString('tr-TR'), num: true },
      { v: r.coverage.toFixed(1) + '%', num: true, cls: r.elbow ? 'sig' : '' },
      { v: (r.gain >= 0.05 ? '+' + r.gain.toFixed(1) : '—'), num: true, cls: r.gain < 5 ? 'muted' : '' },
    ]));

  const mnCand = [5, 10, 15, 30, 45, 60, 120, 240, 480, 1440, 4320];
  const mnRows = computeCoverageTable(dist.minuteVals, mnCand);
  makeTableCard(els.cs10Grid, 'Pencere kararı — SÜRE ölçeği',
    'aynı mantık dakika cinsinden',
    [{ label: 'Pencere' }, { label: 'Kapsanan iptal', num: true }, { label: 'Kapsam', num: true }, { label: 'Ek kazanç', num: true }],
    mnRows.map((r) => [
      { v: fmtM(r.window) + (r.elbow ? '  ◀ dirsek' : ''), cls: r.elbow ? 'sig' : '' },
      { v: r.covered.toLocaleString('tr-TR'), num: true },
      { v: r.coverage.toFixed(1) + '%', num: true, cls: r.elbow ? 'sig' : '' },
      { v: (r.gain >= 0.05 ? '+' + r.gain.toFixed(1) : '—'), num: true, cls: r.gain < 5 ? 'muted' : '' },
    ]));
}

// ================= KONTROL KOLU / KOMBINASYON / T0-CAPALI SAGKALIM =================

// Bir "capa" anindan (iptal veya yenileme) geriye dogru, temizlenmis ve en
// yeniden eskiye sirali olay dizisi. Iki kol da AYNI kaynaktan (userSeq)
// beslensin diye ayri yardimci - aksi halde kollar farkli veri havuzlarindan
// gelir ve karsilastirma adil olmaz.
function buildPreAnchorSeq(userSeq, anchorMap, excludeSet) {
  const out = new Map();
  for (const [uid, anchorT] of anchorMap.entries()) {
    const seq = userSeq.get(uid);
    if (!seq) continue;
    const s = seq.filter((e) => e.t < anchorT && !excludeSet.has(e.ev)).sort((a, b) => b.t - a.t);
    if (s.length > 0) out.set(uid, s);
  }
  return out;
}

// Tek kol icin b/c sayimi (case-crossover cekirdegi)
function crossoverCounts(seqMap, X) {
  const stats = new Map();
  let eligible = 0, dropped = 0;
  for (const s of seqMap.values()) {
    if (s.length < 2 * X) { dropped++; continue; }
    eligible++;
    const caseW = new Set(s.slice(0, X).map((e) => e.ev));
    const ctrlW = new Set(s.slice(X, 2 * X).map((e) => e.ev));
    for (const nm of new Set([...caseW, ...ctrlW])) {
      if (!stats.has(nm)) stats.set(nm, { b: 0, c: 0 });
      const st = stats.get(nm);
      const inCase = caseW.has(nm), inCtrl = ctrlW.has(nm);
      if (inCase && !inCtrl) st.b++;
      else if (!inCase && inCtrl) st.c++;
    }
  }
  return { stats, eligible, dropped };
}

// KONTROL KOLLU CASE-CROSSOVER (case-time-control tasarimi).
//
// Duz case-crossover'in bilinen zayifligi ZAMAN EGILIMI YANLILIGI: sabit
// faturalandirma gunu varsa HERKES donem sonuna yaklasirken aboneligine
// bakiyor olabilir. O zaman iptal edenlerde "arttı" gorursun ama bu iptal
// sinyali degil, takvimin kendi etkisidir.
//
// Cozum: ayni hesabi YENILEYENLER icin de yap (capa = yenileme ani).
//   Duzeltilmis OR = iptal kolu OR / yenileme kolu OR
//   yenileme OR ~ 1        -> zaman egilimi yok, sinyal gercek
//   yenileme OR ~ iptal OR -> sinyalin tamami takvim etkisi
function computeCaseCrossoverControlled(cancelSeqs, renewalSeqs, X, minPairs = 5) {
  const A = crossoverCounts(cancelSeqs, X);
  const B = crossoverCounts(renewalSeqs, X);

  // Haldane-Anscombe duzeltmesi: sifir hucre varsa oran tanimsiz/sonsuz olur;
  // her hucreye 0.5 ekleyerek sonlu ve karsilastirilabilir tutuyoruz.
  const safeOR = (b, c) => {
    if (b === 0 && c === 0) return null;
    if (b === 0 || c === 0) return (b + 0.5) / (c + 0.5);
    return b / c;
  };

  const rows = [];
  for (const [name, sc] of A.stats.entries()) {
    const discordant = sc.b + sc.c;
    if (discordant < minPairs) continue;
    const sr = B.stats.get(name) || { b: 0, c: 0 };
    const renewalPairs = sr.b + sr.c;
    const orCancel = safeOR(sc.b, sc.c);
    const test = mcNemarTest(sc.b, sc.c);

    // Kontrol kolunda UYUMSUZ CIFT YOKSA: o olayda zaman egilimi SAPTANMADI
    // demektir, dolayisiyla duzeltme carpani 1'dir. Burayi null birakmak
    // ters sonuc verirdi - kontrol kolunda hic gorulmeyen bir olay aslinda
    // EN GUCLU kanittir, siralamada dibe dusmemeli.
    // Ancak yenileme kolu bastan bosea (hic uygun kullanici yoksa) duzeltme
    // yapilamaz; o durumda acikca null dondurup UI'da isaretliyoruz.
    let orRenewal, orAdj, correctable;
    if (B.eligible === 0) {
      orRenewal = null; orAdj = null; correctable = false;
    } else if (renewalPairs === 0) {
      orRenewal = 1; orAdj = orCancel; correctable = true;
    } else {
      orRenewal = safeOR(sr.b, sr.c);
      orAdj = (orCancel !== null && orRenewal > 0) ? orCancel / orRenewal : null;
      correctable = true;
    }

    rows.push({
      name, b: sc.b, c: sc.c, discordant, orCancel,
      bRen: sr.b, cRen: sr.c, orRenewal, renewalPairs, orAdj, correctable,
      // duzeltme az veriye dayaniyorsa guvenilmez - UI'da soluklastirilir
      weakCorrection: correctable && renewalPairs > 0 && renewalPairs < 10,
      chi2: test.chi2, p: test.p,
    });
  }
  rows.sort((x, y) => (y.orAdj === null ? -1 : y.orAdj) - (x.orAdj === null ? -1 : x.orAdj));
  return { rows, cancelArm: A, renewalArm: B };
}

// OLAY KOMBINASYONU: son N olayda secili olaylardan hangileri var?
// Her kombinasyon icin iptal orani + Wilson GA + taban orana kat.
// Ayrica BAGIMSIZLIK altinda beklenen hucre buyuklugu: gozlenen bundan
// belirgin yuksekse iki olayin birlikte gorulmesi tesaduf degildir.
function computeCombinationTable(userSeq, anchorMap, cancelSet, events, N, excludeSet) {
  const evs = events.filter(Boolean);
  if (evs.length === 0) return null;

  const cells = new Map();
  let total = 0, totalCancel = 0;
  const marginal = evs.map(() => 0);

  for (const [uid, anchorT] of anchorMap.entries()) {
    const seq = userSeq.get(uid);
    if (!seq) continue;
    const s = seq.filter((e) => e.t < anchorT && !excludeSet.has(e.ev))
      .sort((a, b) => b.t - a.t).slice(0, N);
    if (s.length === 0) continue;

    const present = new Set(s.map((e) => e.ev));
    const flags = evs.map((nm) => (present.has(nm) ? 1 : 0));
    flags.forEach((f, i) => { if (f) marginal[i]++; });

    const key = flags.join('');
    if (!cells.has(key)) cells.set(key, { flags, n: 0, cancel: 0 });
    const cell = cells.get(key);
    cell.n++; total++;
    if (cancelSet.has(uid)) { cell.cancel++; totalCancel++; }
  }

  const baseRate = total > 0 ? (totalCancel / total) * 100 : 0;
  const rows = [...cells.values()].map((cell) => {
    const ci = wilsonCI(cell.cancel, cell.n);
    let expected = total;
    cell.flags.forEach((f, i) => {
      const pM = total > 0 ? marginal[i] / total : 0;
      expected *= f ? pM : (1 - pM);
    });
    return {
      label: cell.flags.every((f) => f === 0) ? 'hiçbiri'
        : evs.filter((_, i) => cell.flags[i]).map(shortEv).join(' + '),
      flags: cell.flags, n: cell.n, cancel: cell.cancel,
      rate: ci.p, lo: ci.lo, hi: ci.hi,
      lift: baseRate > 0 ? ci.p / baseRate : null,
      liftLo: baseRate > 0 ? ci.lo / baseRate : null,
      liftHi: baseRate > 0 ? ci.hi / baseRate : null,
      expected, small: cell.n < 30,
      depth: cell.flags.reduce((a, b) => a + b, 0),
    };
  }).sort((a, b) => a.depth - b.depth || b.rate - a.rate);

  return { rows, total, totalCancel, baseRate, evs };
}

function shortEv(nm) { return nm.length > 22 ? nm.slice(0, 21) + '…' : nm; }

// T0-CAPALI SAGKALIM (Gorsel 22'nin karsilastirma egrisi icin), gun cinsinden.
function buildSurvivalFromT0(renewalGroup, cancelGroup, cancelTimeLookup, filterFn) {
  const obs = [];
  for (const [uid, g] of cancelGroup.entries()) {
    if (filterFn && !filterFn(uid)) continue;
    const tc = cancelTimeLookup.get(uid);
    if (tc === undefined) continue;
    const d = (tc - g.t0) / SECONDS_PER_DAY;
    if (d >= 0) obs.push({ time: d, event: 1 });
  }
  for (const [uid, g] of renewalGroup.entries()) {
    if (filterFn && !filterFn(uid)) continue;
    const d = (g.tRenewal - g.t0) / SECONDS_PER_DAY;
    if (d >= 0) obs.push({ time: d, event: 0 });
  }
  return obs;
}

// SINYAL SONRASI IPTAL RISKI, iki olcekte:
//   (a) OLAY olcegi: sinyalden sonra kac olay gectiginde iptal geldi
//   (b) SURE olcegi: sinyalden sonra kac dakika gectiginde iptal geldi
//
// Ikisi de Kaplan-Meier ile hesaplaniyor, cunku iptal etmeyenler SANSURLU:
// "iptal etmedi" diye atmak riski dusuk gosterirdi, "iptal etti" saymak
// yuksek. KM her iki olcekte de dogru paydayi tutuyor.
//
// Capa olarak olayin ILK gerceklesmesi aliniyor. Son gerceklesme secilseydi
// gelecege bakmis olurduk (look-ahead bias): "iptalden hemen onceki tiklama"
// zaten tanimi geregi iptale yakin olurdu.
function computePostSignalRisk(userSeq, renewalGroup, cancelGroup, cancelTimeLookup, signalEvent, excludeSet) {
  const eventObs = [];
  const timeObs = [];
  let nUsers = 0, nCancelled = 0;

  const process = (uid, endT, cancelT) => {
    const seq = userSeq.get(uid);
    if (!seq) return;
    const s = seq.filter((e) => !excludeSet.has(e.ev)).sort((a, b) => a.t - b.t);
    const idx = s.findIndex((e) => e.ev === signalEvent);
    if (idx < 0) return;
    nUsers++;
    const T = s[idx].t;

    if (cancelT !== null && cancelT >= T) {
      nCancelled++;
      let k = 0;
      for (let i = idx + 1; i < s.length && s[i].t <= cancelT; i++) k++;
      eventObs.push({ time: k, event: 1 });
      timeObs.push({ time: (cancelT - T) / 60, event: 1 });
    } else {
      // sansurlu: gozlem sinyalden sonra su kadar olay / dakika surdu
      eventObs.push({ time: s.length - 1 - idx, event: 0 });
      timeObs.push({ time: Math.max(0, (endT - T) / 60), event: 0 });
    }
  };

  for (const [uid, g] of cancelGroup.entries()) {
    const tc = cancelTimeLookup.has(uid) ? cancelTimeLookup.get(uid) : null;
    process(uid, g.windowEnd, tc);
  }
  for (const [uid, g] of renewalGroup.entries()) process(uid, g.tRenewal, null);

  return { eventObs, timeObs, nUsers, nCancelled };
}

// KM egrisini "birikimli iptal olasiligi" egrisine cevirir: 1 - S(t)
function toCumulativeRisk(km, maxX) {
  return km.points
    .filter((p) => p.t <= maxX)
    .map((p) => ({ x: p.t, y: (1 - p.s) * 100, lo: (1 - p.hi) * 100, hi: (1 - p.lo) * 100 }));
}

// Yuzdelik (lineer interpolasyonlu)
// SINYAL SONRASI DAGILIM: pencere secmek icin.
//
// DIKKAT - bu dagilim YALNIZCA sinyalden sonra iptal EDENLERI kapsar
// (kosullu dagilim). "p90 = 25 olay" demek, "iptal edenlerin %90'i 25 olay
// icinde iptal etti" demektir; "sinyali yapanlarin %90'i iptal eder"
// DEMEK DEGILDIR. O oran icin birikimli risk egrisine bak.
function computePostSignalDistribution(risk) {
  const eventVals = risk.eventObs.filter((o) => o.event === 1).map((o) => o.time).sort((a, b) => a - b);
  const minuteVals = risk.timeObs.filter((o) => o.event === 1).map((o) => o.time).sort((a, b) => a - b);
  const pct = (arr) => ({
    p50: percentile(arr, 50), p75: percentile(arr, 75),
    p90: percentile(arr, 90), p95: percentile(arr, 95),
    max: arr.length ? arr[arr.length - 1] : null,
  });
  return {
    eventVals, minuteVals,
    eventPct: pct(eventVals), minutePct: pct(minuteVals),
    n: eventVals.length,
  };
}

// KAPSAMA TABLOSU: "pencereyi N yaparsam iptallerin yuzde kacini kapsarim"
// ve bir onceki adima gore EK KAZANC. Optimum pencere, ek kazancin belirgin
// dustugu "dirsek" noktasidir - tabloda isaretleniyor.
function computeCoverageTable(sortedVals, candidates) {
  const n = sortedVals.length;
  if (n === 0) return [];
  let prev = 0;
  const rows = candidates.map((w) => {
    // <= w olan gozlem sayisi (dizi sirali oldugu icin ikili arama yeterli)
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedVals[mid] <= w) lo = mid + 1; else hi = mid; }
    const cov = (lo / n) * 100;
    const gain = cov - prev;
    prev = cov;
    return { window: w, covered: lo, coverage: cov, gain };
  });
  // dirsek: ek kazancin ilk kez 5 puanin altina dustugu satir
  const elbowIdx = rows.findIndex((r, i) => i > 0 && r.gain < 5);
  if (elbowIdx > 0) rows[elbowIdx - 1].elbow = true;
  return rows;
}

// Yaklasik hedef bin sayisina gore "yuvarlak" bin genisligi secer
// ================= SINYAL OLAYININ GUNU =================

// (a) Olay hangi gunlerde gorunuyor (tum gerceklesmeler)
// (b) Olayi o gunde yapanlarin iptal orani
// Ikinci hesapta her kullanici ILK gerceklesmesinin gunune atanir - aksi
// halde birden fazla gun aktif olan kullanici cift sayilirdi.
function computeSignalByDay(signalEvent, renewalGroup, cancelGroup, userSeq, windowDays) {
  const occCounts = new Map();     // gun -> gerceklesme sayisi
  const dayStats = new Map();      // gun -> {total, cancelled}

  const process = (uid, t0, isCancel) => {
    const seq = userSeq.get(uid);
    if (!seq) return;
    let firstT = null;
    for (const e of seq) {
      if (e.ev !== signalEvent) continue;
      const d = Math.min(windowDays + 1, Math.max(1, dayNumberUTC(e.t, t0)));
      occCounts.set(d, (occCounts.get(d) || 0) + 1);
      if (firstT === null || e.t < firstT) firstT = e.t;
    }
    if (firstT === null) return;
    const fd = Math.min(windowDays + 1, Math.max(1, dayNumberUTC(firstT, t0)));
    let s = dayStats.get(fd);
    if (!s) { s = { total: 0, cancelled: 0 }; dayStats.set(fd, s); }
    s.total++;
    if (isCancel) s.cancelled++;
  };

  for (const [uid, g] of cancelGroup.entries()) process(uid, g.t0, true);
  for (const [uid, g] of renewalGroup.entries()) process(uid, g.t0, false);

  const days = [];
  for (let d = 1; d <= windowDays + 1; d++) days.push(d);
  return {
    occurrences: days.map((d) => ({ day: d, count: occCounts.get(d) || 0 })),
    rates: days.map((d) => {
      const s = dayStats.get(d) || { total: 0, cancelled: 0 };
      return { key: String(d), label: String(d), total: s.total, cancelled: s.cancelled, ...wilsonCI(s.cancelled, s.total) };
    }).filter((r) => r.total > 0),
  };
}

// ================= SINYALDEN ONCEKI OLAYLAR =================

// Secili olayin ILK gerceklesmesinden hemen ONCEKI N olayin tur dagilimi.
// "Kullaniciyi bu olaya iten ne oldu" sorusuna bakar.
function computePrecedingEvents(signalEvent, userSeq, uidList, N, excludeSet, topN = 15) {
  const counts = new Map();
  let slots = 0, users = 0;
  const perPosition = Array.from({ length: N }, () => new Map());

  for (const uid of uidList) {
    const seq = userSeq.get(uid);
    if (!seq) continue;
    const s = seq.filter((e) => !excludeSet.has(e.ev)).sort((a, b) => a.t - b.t);
    const idx = s.findIndex((e) => e.ev === signalEvent);
    if (idx <= 0) continue; // olay yok ya da ilk olay (oncesi bos)
    users++;
    const start = Math.max(0, idx - N);
    for (let i = idx - 1; i >= start; i--) {
      counts.set(s[i].ev, (counts.get(s[i].ev) || 0) + 1);
      slots++;
      const pos = idx - 1 - i; // 0 = hemen once
      perPosition[pos].set(s[i].ev, (perPosition[pos].get(s[i].ev) || 0) + 1);
    }
  }

  const rows = [...counts.entries()]
    .map(([name, count]) => ({ name, count, pct: slots > 0 ? (count / slots) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  const immediate = [...perPosition[0].entries()]
    .map(([name, count]) => ({ name, count, pct: users > 0 ? (count / users) * 100 : 0 }))
    .sort((a, b) => b.count - a.count).slice(0, topN);

  return { rows: rows.slice(0, topN), allRows: rows, slots, users, immediate };
}

const precIgnore = new Set();

function renderPrecIgnoreList(rows) {
  const box = els.csPrecIgnoreBox;
  if (!box) return;
  box.innerHTML = '';
  rows.slice(0, 50).forEach((r) => {
    const lab = document.createElement('label');
    lab.className = 'filter-item';
    const checked = precIgnore.has(r.name) ? ' checked' : '';
    lab.innerHTML = `<input type="checkbox"${checked} data-ev="${escapeAttr(r.name)}">` +
      `<span class="fname">${escapeXml(r.name)}</span>` +
      `<span class="fcount">${r.count.toLocaleString('tr-TR')}</span>`;
    box.appendChild(lab);
  });
  // Dinleyici YALNIZCA BIR KEZ baglanir. Kutu DOM'da kaldigi icin her yeniden
  // cizimde yeniden baglansa dinleyiciler birikir ve tek tikta analiz defalarca
  // calisirdi.
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('change', (ev) => {
      const cb = ev.target;
      if (!cb || !cb.dataset || !cb.dataset.ev) return;
      if (cb.checked) precIgnore.add(cb.dataset.ev); else precIgnore.delete(cb.dataset.ev);
      try { runFilteredAnalysis(); } catch (err) { console.error(err); }
    });
  }
}

// Olay yoksayma listesi: kullanici tik atarak zorunlu/gurultulu olaylari
// grafikten cikarir. Secim state'te tutulur, yeniden cizimde korunur.
// ---------------- render: sinyal olayinin gunu ----------------

function renderSignalByDay(sbd, signalEvent, windowDays) {
  els.cs11Grid.innerHTML = '';
  if (!signalEvent || !sbd) {
    els.cs11Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Sinyal eventi seç.</div></div>';
    return;
  }
  const labels = sbd.occurrences.map((o) => String(o.day));
  const totalOcc = sbd.occurrences.reduce((s, o) => s + o.count, 0);
  const h1 = makeChartCard(els.cs11Grid, `"${signalEvent}" hangi günlerde yapılıyor`,
    `KAPSAM: yalnızca renewal/cancel grubuna atanmış kullanıcılar, gözlem penceresi içinde · ${totalOcc.toLocaleString('tr-TR')} gerçekleşme`,
    `Bu olay abonelik döngüsünün hangi günlerinde yoğunlaşıyor. <b>Sayı Görsel 18'deki katalogdan düşüktür ve bu doğrudur</b> — katalog dosyanın tamamını sayar (abone olmayanlar, yıllık plan kullanıcıları ve pencere dışındaki olaylar dahil), buradaki sayım ise yalnızca haftalık plan alıp renewal/cancel grubuna atanmış kullanıcıların gözlem penceresi içindeki olaylarını kapsar. Son sütun (${windowDays + 1}) pencere sonrası taşan gerçekleşmeleri toplar.`);
  renderBar(h1, labels, sbd.occurrences.map((o) => o.count), PALETTE.brass || PALETTE.cancelLight,
    { xLabel: 'Döngü günü', yLabel: 'Gerçekleşme sayısı' });

  const h2 = makeChartCard(els.cs11Grid, `Hangi günde yaparsa iptal oranı ne`,
    'her kullanıcı olayı İLK yaptığı güne atanır · çubuklar %95 Wilson GA',
    'Asıl soru bu: olayı 5. günde yapan mı yoksa 7. günde yapan mı daha çok iptal ediyor? Aralıklar üst üste biniyorsa aradaki fark yorumlanamaz. Her kullanıcı yalnızca bir güne sayılır (ilk gerçekleşme), aksi halde birden fazla gün aktif olanlar çift sayılırdı.');
  renderBarCI(h2, sbd.rates, PALETTE.cancel, { xLabel: 'Olayın ilk yapıldığı gün', yLabel: 'İlk hafta cancel oranı (%)' });
}

// ---------------- render: sinyalden onceki olaylar ----------------

function renderPrecedingEvents(pe, signalEvent, N) {
  els.cs12Grid.innerHTML = '';
  if (!signalEvent || !pe || pe.users === 0) {
    els.cs12Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Sinyal eventi seç.</div></div>';
    return;
  }
  const shortN = (n) => (n.length > 28 ? n.slice(0, 27) + '…' : n);

  // Yoksayma listesi TUM olaylardan kurulur; grafikler yalnizca kalanlari gosterir.
  renderPrecIgnoreList(pe.allRows);
  const visRows = pe.rows.filter((r) => !precIgnore.has(r.name));
  const visImmediate = pe.immediate.filter((r) => !precIgnore.has(r.name));
  const visAllRows = pe.allRows.filter((r) => !precIgnore.has(r.name));

  const h1 = makeChartCard(els.cs12Grid, `"${signalEvent}" öncesindeki ${N} olay`,
    `KAPSAM: renewal/cancel grubu, gözlem penceresi içinde · ${pe.users.toLocaleString('tr-TR')} kullanıcı · ${pe.slots.toLocaleString('tr-TR')} olay yuvası · ${precIgnore.size} olay yoksayıldı`,
    `Olayın İLK gerçekleşmesinden hemen önceki ${N} olayın tür dağılımı. Yüzde, tüm önceki-olay yuvalarına oranıdır. "Kullanıcıyı bu olaya iten ne oldu" sorusuna bakar — ama sıradan bir gezinme olayı burada da yüksek çıkabilir, kıyas için genel event kataloğundaki oranlarla karşılaştır.`);
  renderBar(h1, visRows.map((r) => shortN(r.name)), visRows.map((r) => Math.round(r.pct * 10) / 10), PALETTE.renew,
    { widthPerBar: 52, rotateLabels: true, yLabel: 'Önceki olay yuvalarındaki oran (%)' });

  const h2 = makeChartCard(els.cs12Grid, 'Hemen önceki olay (1 adım geride)',
    `${pe.users.toLocaleString('tr-TR')} kullanıcı`,
    'Yalnızca sinyalden bir adım önceki olay. Yüzde, kullanıcı sayısına oranıdır. Bu grafik daha keskin: tam olarak neyin ardından o butona basıldığını gösterir.');
  renderBar(h2, visImmediate.map((r) => shortN(r.name)), visImmediate.map((r) => Math.round(r.pct * 10) / 10), PALETTE.renewLight,
    { widthPerBar: 52, rotateLabels: true, yLabel: 'Kullanıcı oranı (%)' });

  makeTableCard(els.cs12Grid, 'Önceki olaylar dökümü',
    `sinyalden önceki ${N} olay içinde görülme sıklığı · ${precIgnore.size} olay yoksayıldı`,
    [{ label: 'Event' }, { label: 'Görülme', num: true }, { label: 'Yuva oranı', num: true }],
    visAllRows.slice(0, 40).map((r) => [
      r.name,
      { v: r.count.toLocaleString('tr-TR'), num: true },
      { v: r.pct.toFixed(1) + '%', num: true },
    ]));
}

