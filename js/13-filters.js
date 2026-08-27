// ---------------- Filtre UI ----------------

function renderFilterUI(p1) {
  els.filterGrid.innerHTML = '';
  els.filterGrid.appendChild(buildFilterGroup('country', 'Ülke', p1.countryFreq));
  els.filterGrid.appendChild(buildFilterGroup('os', 'OS', p1.osFreq));
  els.filterGrid.appendChild(buildFilterGroup('model', 'Telefon Modeli', p1.modelFreq));
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const triggerFilteredAnalysis = debounce(() => runFilteredAnalysis(), 120);

function buildFilterGroup(key, title, freqMap) {
  const group = document.createElement('div');
  group.className = 'filter-group';
  group.dataset.filterKey = key;

  const sorted = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);

  const head = document.createElement('div');
  head.className = 'filter-group-head';
  head.innerHTML = `<h4>${title} (${sorted.length})</h4>
    <div class="filter-group-actions">
      <button type="button" data-action="all">tümü</button>
      <button type="button" data-action="none">hiçbiri</button>
    </div>`;
  group.appendChild(head);

  const list = document.createElement('div');
  list.className = 'filter-list';

  if (sorted.length === 0) {
    list.innerHTML = `<div class="filter-empty">değer bulunamadı — kolon adını Ayarlar'dan kontrol et</div>`;
  } else {
    sorted.forEach(([value, count], idx) => {
      const item = document.createElement('label');
      item.className = 'filter-item';
      item.innerHTML = `
        <input type="checkbox" checked data-value="${escapeAttr(String(value))}">
        <span class="fname">${escapeXml(String(value))}</span>
        <span class="fcount">${count.toLocaleString('tr-TR')}</span>`;
      list.appendChild(item);
    });
  }
  group.appendChild(list);

  // Herhangi bir checkbox degistiginde filtre otomatik + aninda uygulanir
  // (dosya okumasi yok, sadece bellek ici Map filtreleme + agregasyon).
  list.addEventListener('change', (e) => {
    if (e.target.matches('input[type=checkbox]')) triggerFilteredAnalysis();
  });

  head.querySelector('[data-action="all"]').addEventListener('click', () => {
    list.querySelectorAll('input[type=checkbox]').forEach((cb) => (cb.checked = true));
    triggerFilteredAnalysis();
  });
  head.querySelector('[data-action="none"]').addEventListener('click', () => {
    list.querySelectorAll('input[type=checkbox]').forEach((cb) => (cb.checked = false));
    triggerFilteredAnalysis();
  });

  return group;
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function getSelectedValues(key) {
  const group = els.filterGrid.querySelector(`[data-filter-key="${key}"]`);
  if (!group) return new Set();
  const checked = [...group.querySelectorAll('input[type=checkbox]:checked')].map((cb) => cb.dataset.value);
  return new Set(checked);
}

// ---------------- ADIM 2: Filtreli analiz ----------------

function runFilteredAnalysis() {
  if (!state) return;
  hideAllVisuals();

  const { cfg, p1, m } = state;

  const selectedCountries = getSelectedValues('country');
  const selectedOs = getSelectedValues('os');
  const selectedModels = getSelectedValues('model');

  const matches = (uid) => {
    if (selectedCountries.size > 0 && !selectedCountries.has(p1.resolvedCountry.get(uid))) return false;
    if (selectedOs.size > 0 && !selectedOs.has(p1.resolvedOs.get(uid))) return false;
    if (selectedModels.size > 0 && !selectedModels.has(p1.resolvedModel.get(uid))) return false;
    return true;
  };

  const filteredRenewalGroup = new Map([...p1.renewalGroup.entries()].filter(([uid]) => matches(uid)));
  const filteredCancelGroup = new Map([...p1.cancelGroup.entries()].filter(([uid]) => matches(uid)));
  const filteredCancelTimeLookup = new Map([...p1.cancelTimeLookup.entries()].filter(([uid]) => filteredCancelGroup.has(uid)));

  logLine(`Filtre uygulandı. RENEWAL: ${filteredRenewalGroup.size.toLocaleString('tr-TR')}, CANCEL: ${filteredCancelGroup.size.toLocaleString('tr-TR')}`);

  if (filteredRenewalGroup.size === 0 && filteredCancelGroup.size === 0) {
    logLine('UYARI: seçili filtrelerle eşleşen hiç kullanıcı yok.');
    els.emptyState.style.display = 'block';
    els.emptyState.textContent = 'Seçili filtrelerle eşleşen hiç kullanıcı bulunamadı. Filtreleri gevşetip tekrar dene.';
    return;
  }

  const renewalT0 = new Map([...filteredRenewalGroup.entries()].map(([uid, g]) => [uid, g.t0]));
  const cancelT0 = new Map([...filteredCancelGroup.entries()].map(([uid, g]) => [uid, g.t0]));

  const windowDays = cfg.windowDays;
  const renewalAgg = aggregateGroup(renewalT0, m, windowDays);
  const cancelAgg = aggregateGroup(cancelT0, m, windowDays);

  renderStats(filteredRenewalGroup.size, filteredCancelGroup.size, p1.renewalGroup.size, p1.cancelGroup.size);
  renderVisual1(renewalAgg, cancelAgg, windowDays);

  // Görsel 3 populasyonu t0 aninda abone olan TUM kullanicilar (renewal ∪
  // cancel) - sadece cancel grubu degil, aksi halde renewal olanlar
  // histogramdan sessizce dusuyordu (bkz. computeCancelActualDayDistribution
  // yorumu). allT0 asagida baska hesaplar icin de tekrar kullaniliyor.
  const allT0 = new Map([...renewalT0.entries(), ...cancelT0.entries()]);
  const cancelActualDay = computeCancelActualDayDistribution(allT0, new Set(cancelT0.keys()), filteredCancelTimeLookup, windowDays);
  renderVisual3(cancelActualDay, windowDays);

  const renewalDay7Active = computeLastDayActiveDaysHistogram(renewalT0, m.lastEventTime, m.activeDaysSet, windowDays);
  const cancelDay7Active = computeLastDayActiveDaysHistogram(cancelT0, m.lastEventTime, m.activeDaysSet, windowDays);
  renderVisual4(renewalDay7Active, cancelDay7Active, windowDays);

  // SCATTER: gun 1 sonunda kalan (min) coin -> gun 2'de geri donme yuzdesi,
  // 10'luk coin dilimlerine gore. Renewal ve cancel grubu icin ayri.
  const renewalScatter = computeDay1CoinToDay2Return(renewalT0, m.dayCoinRange, m.activeDaysSet, 10);
  const cancelScatter = computeDay1CoinToDay2Return(cancelT0, m.dayCoinRange, m.activeDaysSet, 10);
  renderScatterVisual(renewalScatter, cancelScatter);

  // SCATTER 2: gun 2'de KALAN (o gunun min) coin -> gun 2'de UYGULAMAYA GIREN
  // kullanicilar arasinda, CANCEL'in TAM OLARAK gun 2'de gerceklesme yuzdesi.
  // "Gun 2'ye girip coini kalmadigini gorunce hemen cancel ediyorlar mi"
  // sorusunun nicel cevabi - populasyon TUM kullanicilar (grup ayrimi yok).

  // AI SEGMENTI: custom_image_edit turleri yapisal olarak fail'e yatkin
  // oldugu icin diger turlerle birlikte degerlendirmek yaniltici olur.
  // Kullanici ILK generation denemesinin turune gore segmente atanir.
  const customSet = new Set((cfg.customAiTypes || []).map(normalizeAiName));
  const aiSeg = state.aiSegment || 'all';
  const segSizes = segmentSizes(allT0, m.genInfoGF, customSet);
  const segRenewalT0 = filterBySegment(renewalT0, m.genInfoGF, customSet, aiSeg);
  const segCancelT0 = filterBySegment(cancelT0, m.genInfoGF, customSet, aiSeg);
  const segAllT0 = new Map([...segRenewalT0.entries(), ...segCancelT0.entries()]);
  const segRenewalGroup = filterGroupBySegment(filteredRenewalGroup, m.genInfoGF, customSet, aiSeg);
  const segCancelGroup = filterGroupBySegment(filteredCancelGroup, m.genInfoGF, customSet, aiSeg);
  const segCancelTimes = new Map([...filteredCancelTimeLookup.entries()].filter(([uid]) => segCancelGroup.has(uid)));
  if (els.aiSegNote) {
    els.aiSegNote.textContent = `Tümü: ${segSizes.all.toLocaleString('tr-TR')} · custom image edit: ${segSizes.custom.toLocaleString('tr-TR')} · diğer türler: ${segSizes.other.toLocaleString('tr-TR')} · hiç deneme yok: ${segSizes.none.toLocaleString('tr-TR')}`;
  }
  const day2CancelRate = computeDay2CoinToCancelRate(allT0, m.dayCoinRange, m.activeDaysSet, filteredCancelTimeLookup, 10);
  renderDay2CancelRateVisual(day2CancelRate);

  // ---- GÖRSEL SAYISI -> YENİLEME ORANI SEKMESİ ----
  // Segmentlenmemis (aiSegment filtresine duyarli DEGIL) TUM renewal/cancel
  // kullanicilari - demografik filtreye duyarli (filteredRenewalGroup/
  // filteredCancelGroup uzerinden turetilen renewalT0/cancelT0 kullaniliyor).
  const imgRenewalAnalysis = computeImageCountRenewalAnalysis(renewalT0, cancelT0, m.imageGenCount);
  renderImageRenewal(imgRenewalAnalysis);

  // ---- GENERATION FAIL SEKMESI ----
  const gfOutcome = computeExposureVsOutcome(segRenewalT0, segCancelT0, m.genInfoGF);
  const gfDay2 = computeDay2ReturnByExposure(segRenewalGroup, segCancelGroup, m.genInfoGF, m.activeDaysSet);
  const gfLastDay = computeLastDayByExposure(segAllT0, m.genInfoGF, m.lastEventTime, windowDays);
  const gfElapsed = computeFailToCancelElapsed(segCancelT0, m.genInfoGF, segCancelTimes);
  const gfDose = computeDoseResponse(segRenewalT0, segCancelT0, m.genInfoGF);
  const gfFailRatio = computeFailRatioResponse(segRenewalT0, segCancelT0, m.genInfoGF, m.imageGenCount);
  renderAiTypes(
    computeAiTypeDistribution(m.aiByUserGF, m.genInfoGF, segAllT0),
    // Zaman cizelgesi TUM ZAMANLAR verisini kullanir: "hangi donemde
    // kullanildi" sorusu 7 gunluk pencereyle sinirlanamaz.
    computeAiTimeline(m.aiDailyAll, m.aiByTypeAll, 10, 30),
    computeAiTypeAllTime(m.aiByTypeAll));
  renderGenFailVisuals(gfOutcome, gfDay2, gfLastDay, gfElapsed, gfDose, gfFailRatio, windowDays);

  // ---- ILERI ANALIZ SEKMESI (sagkalim + model) ----
  const survObs = buildSurvivalObs(filteredRenewalGroup, filteredCancelGroup, filteredCancelTimeLookup, windowDays);
  const strata = stratifySurvival(survObs, m.genInfo);
  const logRank = logRankTest(strata);
  const hazardRows = discreteHazard(survObs.map((o) => ({ time: o.time, event: o.event })), windowDays);
  const modelResult = fitCancelModel(renewalT0, cancelT0, m.genInfo, m.dayCoinRange);
  renderAdvancedVisuals(strata, logRank, hazardRows, modelResult, windowDays);

  // ---- CANCEL ONCESI SINYAL SEKMESI ----
  const X = state.csX || 20;
  const excludeSet = new Set((state.csExclude || '').split(',').map((s) => s.trim()).filter(Boolean));
  const signalEvent = state.csSignal || null;
  const funnelSteps = [state.csF1, state.csF2, state.csF3, state.csF4].filter(Boolean);

  const filteredPreCancel = new Map();
  for (const uid of filteredCancelGroup.keys()) {
    if (m.preCancelSeq.has(uid)) filteredPreCancel.set(uid, m.preCancelSeq.get(uid));
  }

  // Kontrol kollu case-crossover: iki kol da AYNI kaynaktan (userSeq) beslenir
  const cancelAnchors = new Map();
  for (const [uid, g] of filteredCancelGroup.entries()) {
    const tc = filteredCancelTimeLookup.get(uid);
    if (tc !== undefined) cancelAnchors.set(uid, tc);
  }
  const renewalAnchors = new Map();
  for (const [uid, g] of filteredRenewalGroup.entries()) renewalAnchors.set(uid, g.tRenewal);

  const cancelSeqs = buildPreAnchorSeq(m.userSeq, cancelAnchors, excludeSet);
  const renewalSeqs = buildPreAnchorSeq(m.userSeq, renewalAnchors, excludeSet);
  const controlledCC = computeCaseCrossoverControlled(cancelSeqs, renewalSeqs, X);

  renderCancelSignals({
    X, signalEvent,
    catalog: computeEventCatalog(p1.eventNameCounts, m.userEventInfo, p1.renewalGroup.size + p1.cancelGroup.size),
    diag: computeWindowDiagnostics(filteredPreCancel, filteredCancelGroup.size, X, excludeSet),
    crossover: controlledCC,
    funnelCancel: computeFunnel(funnelSteps, cancelT0, m.userEventInfo),
    funnelRenewal: computeFunnel(funnelSteps, renewalT0, m.userEventInfo),
    signalKM: signalEvent ? (() => {
      const didEvent = (uid) => {
        const em = m.userEventInfo.get(uid);
        return !!(em && em.get(signalEvent));
      };
      const ev = buildSignalToCancelObs(signalEvent, filteredRenewalGroup, filteredCancelGroup, filteredCancelTimeLookup, m.userEventInfo);
      const evCancel = ev.filter((o) => o.event === 1).map((o) => o.time).sort((a, b) => a - b);
      return {
        signal: buildSurvivalFromT0(filteredRenewalGroup, filteredCancelGroup, filteredCancelTimeLookup, didEvent),
        all: buildSurvivalFromT0(filteredRenewalGroup, filteredCancelGroup, filteredCancelTimeLookup, null),
        medianSignalToCancelH: median(evCancel),
      };
    })() : null,
    trigger: signalEvent ? computeTriggerPerformance(signalEvent, renewalT0, cancelT0, filteredCancelTimeLookup, m.userEventInfo) : null,
    reverseTrigger: signalEvent ? computeReverseTriggerPerformance(signalEvent, renewalT0, cancelT0, filteredCancelTimeLookup, m.userEventInfo, windowDays) : null,
  });

  // Sinyal olayinin gunu + oncesindeki olaylar
  renderSignalByDay(
    signalEvent ? computeSignalByDay(signalEvent, filteredRenewalGroup, filteredCancelGroup, m.userSeq, windowDays) : null,
    signalEvent, windowDays);
  renderPrecedingEvents(
    signalEvent ? computePrecedingEvents(signalEvent, m.userSeq, allT0.keys(), state.csPrecN || 10, excludeSet) : null,
    signalEvent, state.csPrecN || 10);

  // Sinyal sonrasi iptal riski (olay + sure olcegi)
  const postSignalRisk = state.csRiskEvent
    ? computePostSignalRisk(m.userSeq, filteredRenewalGroup, filteredCancelGroup,
        filteredCancelTimeLookup, state.csRiskEvent, excludeSet)
    : null;
  renderPostSignalRisk(postSignalRisk, state.csRiskEvent, state.csRiskEvents || 20, state.csRiskMinutes || 120);

  // Sinyal sonrasi DAGILIM (pencere secimi icin)
  renderPostSignalDistribution(
    state.csRiskEvent && postSignalRisk ? computePostSignalDistribution(postSignalRisk) : null,
    state.csRiskEvent,
    { eventBin: state.csDistEventBin || 1, eventCap: state.csDistEventCap || 50,
      minuteBin: state.csDistMinuteBin || 5, minuteCap: state.csDistMinuteCap || 120 });

  // Olay kombinasyonu tablosu
  const allAnchors = new Map([...cancelAnchors, ...renewalAnchors]);
  const cancelUidSet = new Set(filteredCancelGroup.keys());
  const comboEvents = [state.csC1, state.csC2, state.csC3].filter(Boolean);
  renderComboTable(
    comboEvents.length > 0
      ? computeCombinationTable(m.userSeq, allAnchors, cancelUidSet, comboEvents, state.csComboN || 15, excludeSet)
      : null,
    state.csComboN || 15);

  // ---- ABONE OLMAYANLAR SEKMESI ----
  // NOT: bu grup demografik filtreden ETKILENMEZ. Filtreler renewal/cancel
  // gruplarina atanmis kullanicilarin ulke/OS/model bilgisine dayanir; abone
  // olmayanlar bu gruplarin disindadir. Sekmede bu acikca belirtiliyor.
  renderImpliedSubSummary((() => {
    const iu = p1.impliedSubUsers || new Set();
    const pro = p1.proSuccessUsers || new Set();
    const noProInImplied = [...iu].filter((uid) => !pro.has(uid)).length;
    const byEvent = [...(p1.impliedSubEventCounts || new Map()).entries()]
      .map(([name, s]) => ({ name, users: s.size }))
      .sort((a, b) => b.users - a.users);
    return {
      impliedUsers: iu.size,
      movedFromNonSub: noProInImplied,
      eventNames: p1.impliedSubEventNames || [],
      byEvent,
    };
  })());

  const reclassifyExcluded = computeReclassifyExclusion(m.nonSubEventUsers, nsReclassify);
  renderReclassifyList(m.nonSubEventCounts, reclassifyExcluded.size);
  const nsFiltered = filterNonSubByExclusion(m.nonSubEventUsers, m.nonSubDays, m.nonSubSpan, m.nonSubUserEvents, reclassifyExcluded);
  const nsSubscriberCount = (m.subUserSeen ? m.subUserSeen.size : 0) + reclassifyExcluded.size;

  renderNonSubscribers(
    computeNonSubscriberStats(nsFiltered.nonSubEventUsers, m.nonSubEventCounts, nsFiltered.nonSubDays, nsFiltered.nonSubSpan,
      nsSubscriberCount,
      m.subEventUsers, m.subEventCounts, nsSubscriberCount,
      computeNonSubTiming(nsFiltered.nonSubDays, nsFiltered.nonSubSpan, 30, state.nsMinSpan !== undefined ? state.nsMinSpan : 7), nsIgnore,
      computeNonSubReturn(nsFiltered.nonSubDays, nsFiltered.nonSubSpan, nsFiltered.nonSubUserEvents, 7, 30),
      (() => {
        const tu = p1.trialUsers || new Set();
        let alsoPro = 0;
        for (const uid of tu) if (p1.proSuccessUsers.has(uid)) alsoPro++;
        const matched = [...(p1.trialMatchedValues || new Map()).entries()]
          .map(([v, s]) => ({ value: v, users: s.size }))
          .sort((a, b) => b.users - a.users);
        return {
          trialUsers: tu.size, trialAlsoPro: alsoPro,
          trialConvPct: tu.size > 0 ? (alsoPro / tu.size) * 100 : 0,
          keywords: (cfg.trialKeywords || []).join(', '),
          matched,
        };
      })()),
    state.nsTopN || 15);

  renderDayComposition(
    computeDayComposition(m.dayComp, m.dayCompUsers, state.nsDayTopN || 10),
    state.nsDayTopN || 10);

  logLine('Filtreli analiz tamamlandı, grafikler render edildi.');
}

// Secili gunde (dayN) en az 1 event ureten (renewal/cancel haric) userlar icin:
//   maxCoinValues  -> her user'in PENCERE BOYUNCA gordugu GLOBAL max current_coins degeri
//   spentValues    -> her user'in SADECE dayN gunundeki max-min coin farki
//                     (o gun icinde "harcanan" miktarin bir yaklasik degeri)
