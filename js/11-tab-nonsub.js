// ================= ABONE OLMAYAN KULLANICILAR =================

// Hic pro_success yapmamis kullanicilarin ozeti. Bu grup diger tum
// sekmelerde GORUNMEZ (renewal/cancel gruplari yalnizca satin alanlardan
// olusur), oysa huninin en genis basamagi burasidir.
function computeNonSubscriberStats(nonSubEventUsers, nonSubEventCounts, nonSubDays, nonSubSpan, subscriberCount, subEventUsers, subEventCounts, subUserCount, timing, ignoreSet, returnAnalysis, trialInfo) {
  const totalUsers = nonSubDays.size;

  const events = [...nonSubEventCounts.entries()].map(([name, count]) => {
    const users = nonSubEventUsers.has(name) ? nonSubEventUsers.get(name).size : 0;
    return { name, count, users, userPct: totalUsers > 0 ? (users / totalUsers) * 100 : 0 };
  }).sort((a, b) => b.users - a.users);

  const activeDays = [];
  for (const ds of nonSubDays.values()) activeDays.push(ds.size);
  activeDays.sort((a, b) => a - b);

  const spanDays = [];
  for (const sp of nonSubSpan.values()) spanDays.push((sp.last - sp.first) / SECONDS_PER_DAY);
  spanDays.sort((a, b) => a - b);

  const oneDayOnly = activeDays.filter((d) => d === 1).length;

  // Abone grubuyla karsilastirma: ayni olay icin her iki gruptaki kullanici
  // yuzdesi ve kisi basi ortalama tekrar sayisi.
  const subN = subUserCount || subscriberCount || 0;
  const compare = events.map((e) => {
    const su = subEventUsers && subEventUsers.has(e.name) ? subEventUsers.get(e.name).size : 0;
    const sc = subEventCounts ? (subEventCounts.get(e.name) || 0) : 0;
    return {
      name: e.name,
      nonSubUserPct: e.userPct,
      subUserPct: subN > 0 ? (su / subN) * 100 : 0,
      nonSubPerUser: e.users > 0 ? e.count / e.users : 0,
      subPerUser: su > 0 ? sc / su : 0,
      nonSubCount: e.count, subCount: sc,
      nonSubUsers: e.users, subUsers: su,
    };
  });

  return {
    totalUsers, subscriberCount, subUserCount: subN, compare, timing, ignoreSet, returnAnalysis, trialInfo,
    conversionPct: (totalUsers + subscriberCount) > 0
      ? (subscriberCount / (totalUsers + subscriberCount)) * 100 : 0,
    events, activeDays, spanDays,
    oneDayOnly,
    oneDayPct: totalUsers > 0 ? (oneDayOnly / totalUsers) * 100 : 0,
    medianActiveDays: percentile(activeDays, 50),
    medianSpanDays: percentile(spanDays, 50),
    totalEvents: [...nonSubEventCounts.values()].reduce((a, b) => a + b, 0),
  };
}

function renderTrialSummary(trialInfo, nonSubTotal) {
  if (!els.ns0Grid) return;
  els.ns0Grid.innerHTML = '';
  if (!trialInfo) return;

  const card = document.createElement('div');
  card.className = 'chart-card';
  const kw = trialInfo.keywords || '(tanımsız)';
  card.innerHTML = `<h3>Trial kullanıcıları — dışlama özeti</h3>
    <div class="chart-sub">product_id / vendor_product_id içinde "${escapeXml(kw)}" geçen kullanıcılar</div>
    <div class="big-stat"><span class="big-num">${trialInfo.trialUsers.toLocaleString('tr-TR')}</span>
      <span class="big-sub">kullanıcı işaretlendi ve abone olmayan gruptan ÇIKARILDI</span></div>
    <div class="perf-grid" style="margin-top:14px;">
      <div><span class="perf-num">${trialInfo.trialAlsoPro.toLocaleString('tr-TR')}</span><span class="perf-lbl">Trial → abone<br><em>sonradan pro_success üretti</em></span></div>
      <div><span class="perf-num">${trialInfo.trialConvPct.toFixed(1)}%</span><span class="perf-lbl">Trial dönüşüm oranı</span></div>
      <div><span class="perf-num">${nonSubTotal.toLocaleString('tr-TR')}</span><span class="perf-lbl">Kalan abone olmayan<br><em>bu sekmedeki popülasyon</em></span></div>
    </div>
    ${trialInfo.trialUsers === 0 ? `<p class="mini-note"><b>Hiç eşleşme bulunamadı.</b> Bu, dosyada trial olmadığı anlamına gelebilir; ama anahtar kelimenin yanlış olması da mümkün. Ayarlar panelinden anahtar kelimeyi kontrol et — şu an aranan: "${escapeXml(kw)}". Doğru değeri bulmak için Görsel 18'deki event kataloğuna ve dosyadaki ürün kimliklerine bakabilirsin.</p>` : ''}`;
  els.ns0Grid.appendChild(card);

  if (trialInfo.matched && trialInfo.matched.length > 0) {
    makeTableCard(els.ns0Grid, 'Eşleşen ürün kimlikleri',
      `${trialInfo.matched.length} farklı değer eşleşti · tespitin doğru çalıştığını buradan gözle doğrulayabilirsin`,
      [{ label: 'product_id / vendor_product_id değeri' }, { label: 'Kullanıcı', num: true }],
      trialInfo.matched.map((mv) => [
        mv.value,
        { v: mv.users.toLocaleString('tr-TR'), num: true },
      ]), { searchable: true, searchPlaceholder: 'Ürün kimliği ara…' });
  }
}

function renderImpliedSubSummary(info) {
  if (!els.nsImpliedGrid) return;
  els.nsImpliedGrid.innerHTML = '';
  if (!info) return;

  const card = document.createElement('div');
  card.className = 'chart-card';
  const evLabel = info.eventNames.length ? info.eventNames.map((e) => `<code>${escapeXml(e)}</code>`).join(', ') : '(tanımsız)';
  card.innerHTML = `<h3>Veri öncesi abonelik kanıtı — düzeltme özeti</h3>
    <div class="chart-sub">${evLabel} event'lerinden herhangi birini üreten kullanıcılar abone tarafına geçirildi</div>
    <div class="big-stat"><span class="big-num">${info.movedFromNonSub.toLocaleString('tr-TR')}</span>
      <span class="big-sub">kullanıcı, hiç <code>pro_success</code> satırı olmadığı halde abone sayıldı ve bu sekmeden ÇIKARILDI</span></div>
    <div class="perf-grid" style="margin-top:14px;">
      <div><span class="perf-num">${info.impliedUsers.toLocaleString('tr-TR')}</span><span class="perf-lbl">Toplam eşleşme<br><em>bu event'lerden en az birini üretti</em></span></div>
      <div><span class="perf-num">${(info.impliedUsers - info.movedFromNonSub).toLocaleString('tr-TR')}</span><span class="perf-lbl">Zaten pro_success'i vardı<br><em>düzeltme bunlarda etkisiz</em></span></div>
      <div><span class="perf-num">${info.movedFromNonSub.toLocaleString('tr-TR')}</span><span class="perf-lbl">Gerçekten taşınan<br><em>veri başlangıcından önce satın almış olmalı</em></span></div>
    </div>
    ${info.movedFromNonSub === 0 ? '<p class="mini-note">Hiç kullanıcı taşınmadı — bu dosyada bu sorun görünmüyor olabilir, ya da event adları Ayarlar panelindeki değerlerle eşleşmiyor olabilir.</p>' : ''}`;
  els.nsImpliedGrid.appendChild(card);

  if (info.byEvent && info.byEvent.length > 0) {
    makeTableCard(els.nsImpliedGrid, 'Hangi event kaç kullanıcıyı işaretledi',
      `${info.byEvent.length} farklı event · bir kullanıcı birden fazla event'te sayılabilir, toplamları basitçe eklemek yanlış olur`,
      [{ label: 'Event adı' }, { label: 'Kullanıcı', num: true }],
      info.byEvent.map((e) => [e.name, { v: e.users.toLocaleString('tr-TR'), num: true }]));
  }
}

function renderNonSubscribers(st, topN) {
  renderTrialSummary(st ? st.trialInfo : null, st ? st.totalUsers : 0);
  els.ns1Grid.innerHTML = '';
  if (!st || st.totalUsers === 0) {
    els.ns1Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Bu dosyada hiç abone olmayan kullanıcı bulunamadı. Muhtemelen önceden filtrelenmiş bir dosya yüklendi (ör. yalnızca pro kullanıcılar). Ham dosyayı yükleyerek bu sekmeyi kullanabilirsin.</div></div>';
    els.ns2Grid.innerHTML = ''; els.ns3Grid.innerHTML = '';
    return;
  }

  const card = document.createElement('div');
  card.className = 'chart-card';
  card.innerHTML = `<h3>Abone olmayan kullanıcılar</h3>
    <div class="chart-sub">veri süresi boyunca hiç ${escapeXml('pro_success')} üretmemiş kullanıcılar</div>
    <div class="big-stat"><span class="big-num">${st.totalUsers.toLocaleString('tr-TR')}</span>
      <span class="big-sub">kullanıcı · ${st.totalEvents.toLocaleString('tr-TR')} olay</span></div>
    <div class="perf-grid" style="margin-top:14px;">
      <div><span class="perf-num">${st.conversionPct.toFixed(1)}%</span><span class="perf-lbl">Dönüşüm oranı<br><em>abone olan / toplam</em></span></div>
      <div><span class="perf-num">${st.medianActiveDays !== null ? st.medianActiveDays.toFixed(0) : '—'}</span><span class="perf-lbl">Medyan aktif gün</span></div>
      <div><span class="perf-num">${st.oneDayPct.toFixed(1)}%</span><span class="perf-lbl">Tek gün aktif<br><em>bir gün gelip kaybolan</em></span></div>
    </div>
    ${st.trialInfo ? `<div class="perf-grid" style="margin-top:12px;">
      <div><span class="perf-num">${st.trialInfo.trialUsers.toLocaleString('tr-TR')}</span><span class="perf-lbl">Trial kullanan<br><em>bu gruptan ÇIKARILDI</em></span></div>
      <div><span class="perf-num">${st.trialInfo.trialAlsoPro.toLocaleString('tr-TR')}</span><span class="perf-lbl">Trial → abone<br><em>sonradan pro_success üretti</em></span></div>
      <div><span class="perf-num">${st.trialInfo.trialConvPct.toFixed(1)}%</span><span class="perf-lbl">Trial dönüşümü</span></div>
    </div>` : ''}
    ${st.trialInfo && st.trialInfo.trialUsers > 0 ? `<p class="mini-note"><b>Trial düzeltmesi uygulandı:</b> product_id / vendor_product_id alanında "${escapeXml(st.trialInfo.keywords)}" geçen ${st.trialInfo.trialUsers.toLocaleString('tr-TR')} kullanıcı bu gruptan çıkarıldı. Bunlar <code>pro_success</code> üretmedikleri halde abonelere özgü ekranlara erişebiliyordu; grupta kalsalardı abone olmayanların davranışını yanlış gösterirlerdi.</p>` : ''}
    <p class="mini-note">Bu grup diğer tüm sekmelerde görünmez — renewal/cancel grupları yalnızca satın alanlardan oluşur. Oysa huninin en geniş basamağı burasıdır: tek gün aktif olanların oranı yüksekse sorun abonelikte değil, ilk deneyimde demektir.</p>`;
  els.ns1Grid.appendChild(card);
  renderIgnoreList(st.compare);

  // ---- Görsel 33: abone vs abone olmayan karşılaştırma ----
  els.ns2Grid.innerHTML = '';
  const ignoreSet = st.ignoreSet || new Set();
  const visible = st.compare.filter((e) => !ignoreSet.has(e.name));
  const top = visible.slice(0, topN);
  const shortName = (n) => (n.length > 24 ? n.slice(0, 23) + '…' : n);

  const h1 = makeChartCard(els.ns2Grid, 'Kullanıcı yüzdesi — abone vs abone olmayan',
    `en yüksek ${top.length} olay · ${ignoreSet.size} olay yoksayıldı · abone n=${st.subUserCount.toLocaleString('tr-TR')} · abone olmayan n=${st.totalUsers.toLocaleString('tr-TR')}`,
    'Her olay için iki çubuk: o olayı <b>en az bir kez</b> yapan kullanıcı oranı. Kırmızı = satın alanlar, yeşil = almayanlar. Aradaki açıklık büyükse o davranış satın almayla ilişkili demektir. Grafik yatay kaydırılabilir.');
  renderGroupedBar(h1, top.map((e) => shortName(e.name)),
    { label: 'Abone (pro_success var)', color: PALETTE.cancel, values: top.map((e) => Math.round(e.subUserPct * 10) / 10) },
    { label: 'Abone olmayan', color: PALETTE.renew, values: top.map((e) => Math.round(e.nonSubUserPct * 10) / 10) },
    { pct: true, yLabel: 'Kullanıcı oranı (%)', widthPerGroup: 68 });

  const h2 = makeChartCard(els.ns2Grid, 'Kişi başı tekrar sayısı — abone vs abone olmayan',
    'o olayı yapanlar arasında ortalama kaç kez yapıldığı',
    'Yüzde grafiği "kaç kişi yaptı" der, bu grafik "<b>kaç kez</b> yaptı" der. İkisi farklı şey söyler: bir olayı iki grup da benzer oranda yapıyor olabilir ama biri çok daha sık tekrarlıyorsa bağlılık farkı oradadır.');
  renderGroupedBar(h2, top.map((e) => shortName(e.name)),
    { label: 'Abone (pro_success var)', color: PALETTE.cancel, values: top.map((e) => Math.round(e.subPerUser * 10) / 10) },
    { label: 'Abone olmayan', color: PALETTE.renew, values: top.map((e) => Math.round(e.nonSubPerUser * 10) / 10) },
    { yLabel: 'Kişi başı ortalama tekrar', widthPerGroup: 64 });

  makeTableCard(els.ns2Grid, 'Olay dökümü — iki grup', 'abone olmayan kullanıcı sayısına göre sıralı',
    [{ label: 'Event' }, { label: 'Abone olmayan: kişi', num: true }, { label: '%', num: true },
     { label: 'toplam olay', num: true }, { label: 'Abone: kişi', num: true }, { label: '%', num: true }, { label: 'toplam olay', num: true }],
    visible.slice(0, 60).map((e) => [
      e.name,
      { v: e.nonSubUsers.toLocaleString('tr-TR'), num: true },
      { v: e.nonSubUserPct.toFixed(1) + '%', num: true },
      { v: e.nonSubCount.toLocaleString('tr-TR'), num: true },
      { v: e.subUsers.toLocaleString('tr-TR'), num: true },
      { v: e.subUserPct.toFixed(1) + '%', num: true },
      { v: e.subCount.toLocaleString('tr-TR'), num: true },
    ]));

  // ---- GERI DONENLER: ilk gunde ne yaptilar ----
  els.ns4Grid.innerHTML = '';
  const ret = st.returnAnalysis;
  if (ret && ret.total > 0) {
    const card2 = document.createElement('div');
    card2.className = 'chart-card';
    card2.innerHTML = `<h3>Ertesi gün geri dönenler</h3>
      <div class="chart-sub">abone olmadığı halde ilk gününden sonraki gün tekrar olay üreten kullanıcılar</div>
      <div class="big-stat"><span class="big-num">${ret.baseRate.toFixed(1)}%</span>
        <span class="big-sub">${ret.returned.toLocaleString('tr-TR')} / ${ret.total.toLocaleString('tr-TR')} kullanıcı</span></div>
      <p class="mini-note">Bu oran <b>taban orandır</b>: aşağıdaki tabloda bir davranışın dönüş oranı bundan belirgin yüksekse, o davranış geri gelmeyle ilişkili demektir. Kampanya yerleştirmek için aday noktalar oradan çıkar.</p>`;
    els.ns4Grid.appendChild(card2);

    makeTableCard(els.ns4Grid, 'İlk gün hangi davranış ertesi gün dönüşü artırıyor',
      `KAPSAM: yalnızca abone olmayan kullanıcılar (trial kullananlar hariç) · taban dönüş oranı %${ret.baseRate.toFixed(1)} · lift'e göre sıralı · en az 30 kullanıcılı olaylar`,
      [{ label: 'İlk gün yapılan olay' }, { label: 'Kişi', num: true }, { label: 'Dönüş oranı (%95 GA)', num: true },
       { label: 'Yapmayanların oranı', num: true }, { label: 'Lift', num: true }],
      ret.rows.slice(0, 40).map((r) => {
        const strong = r.lift !== null && r.lift > 1.2 && r.lo > ret.baseRate;
        return [
          { v: r.name + (strong ? '  ★' : ''), cls: strong ? 'sig' : '' },
          { v: r.withN.toLocaleString('tr-TR'), num: true },
          { v: `${r.withRate.toFixed(1)}% (${r.lo.toFixed(0)}–${r.hi.toFixed(0)})`, num: true, cls: strong ? 'sig' : '' },
          { v: r.withoutRate.toFixed(1) + '%', num: true, cls: 'muted' },
          { v: r.lift === null ? '—' : r.lift.toFixed(2) + '×', num: true, cls: strong ? 'sig' : '' },
        ];
      }), { searchable: true, searchPlaceholder: 'Olay ara…' });

    // MATRIS
    const colLabels = [];
    for (let k = 1; k <= ret.maxRelDay; k++) colLabels.push(k);
    const hmRows = [{ name: 'TÜM KULLANICILAR (taban)', total: ret.total, cells: ret.baseline, isBaseline: true }]
      .concat(ret.matrix);
    const hm = makeChartCard(els.ns4Grid, 'Matris: ilk gün davranışı × sonraki günlerde aktiflik',
      `KAPSAM: yalnızca abone olmayanlar (trial hariç) · satırlar ilk gün yapılan olay · sütunlar kendi ilk gününden sonraki gün · ${ret.total.toLocaleString('tr-TR')} kullanıcı`,
      'Her hücre: o olayı ilk gün yapanların yüzde kaçı k. günde hâlâ aktifti. Renk koyulaştıkça oran yükselir. <b>En üstteki taban satırıyla karşılaştır</b> — bir satır taban satırından belirgin koyu ise o davranış kalıcılıkla ilişkilidir. Sağdaki n, o satırın kaç kullanıcıya dayandığını gösterir; küçükse renk yanıltıcı olabilir.');
    renderHeatmap(hm, hmRows, colLabels, { color: PALETTE.renew, cellW: 46, padLeft: 220 });
  } else {
    els.ns4Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Geri dönüş analizi için yeterli veri yok.</div></div>';
  }

  // ---- Görsel 34: süre dağılımları, KIRPMA YOK, alt alta, kaydırmalı ----
  els.ns3Grid.innerHTML = '';
  const adBins = fixedWidthBins(st.activeDays, 1);
  const h3 = makeChartCard(els.ns3Grid, 'Kaç ayrı günde aktif oldular',
    `medyan ${st.medianActiveDays !== null ? st.medianActiveDays.toFixed(0) : '—'} gün · tüm kullanıcılar dahil, kırpma yok`,
    'Olay ürettikleri FARKLI takvim günü sayısı. 1\'de büyük yığılma varsa çoğu kullanıcı bir gün gelip bir daha dönmüyor demektir — bu, satın alma değil onboarding sorunudur. Grafiği yatay kaydırarak kuyruğu da inceleyebilirsin.');
  renderBar(h3, adBins.labels, adBins.values, PALETTE.renew,
    { widthPerBar: 44, xLabel: 'Aktif gün sayısı', yLabel: 'Kullanıcı sayısı' });

  const spBins = fixedWidthBins(st.spanDays, 1);
  const h4 = makeChartCard(els.ns3Grid, 'İlk ve son olay arası süre',
    `medyan ${st.medianSpanDays !== null ? st.medianSpanDays.toFixed(1) : '—'} gün · günlük dilimler, kırpma yok`,
    'Aktif gün sayısından farklı: bu, ilk ve son olay arasındaki TAKVİM mesafesi. Aktif gün 2 ama yayılım 30 gün ise kullanıcı bir ay arayla iki kez uğramış demektir.');
  renderBar(h4, spBins.labels, spBins.values, PALETTE.renewLight,
    { widthPerBar: 44, xLabel: 'İlk–son olay arası gün', yLabel: 'Kullanıcı sayısı' });
}

// Gun bazli olay bilesimi icin ayri yoksayma listesi (Gorsel 38).
const dayCompIgnore = new Set();

function renderDayCompIgnoreList(buckets) {
  const box = els.nsDayIgnoreBox;
  if (!box) return;
  const totals = new Map();
  buckets.forEach((b) => b.allRows.forEach((r) => {
    totals.set(r.name, (totals.get(r.name) || 0) + r.subCount + r.nonCount);
  }));
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
  box.innerHTML = '';
  sorted.forEach(([nm, n]) => {
    const lab = document.createElement('label');
    lab.className = 'filter-item';
    const checked = dayCompIgnore.has(nm) ? ' checked' : '';
    lab.innerHTML = `<input type="checkbox"${checked} data-ev="${escapeAttr(nm)}">` +
      `<span class="fname">${escapeXml(nm)}</span><span class="fcount">${n.toLocaleString('tr-TR')}</span>`;
    box.appendChild(lab);
  });
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('change', (ev) => {
      const cb = ev.target;
      if (!cb || !cb.dataset || !cb.dataset.ev) return;
      if (cb.checked) dayCompIgnore.add(cb.dataset.ev); else dayCompIgnore.delete(cb.dataset.ev);
      try { runFilteredAnalysis(); } catch (err) { console.error(err); }
    });
  }
}

// ---------------- render: gun bazli olay bilesimi ----------------

function renderDayComposition(buckets, topN) {
  els.ns5Grid.innerHTML = '';
  if (!buckets || buckets.every((b) => b.subTotal === 0 && b.nonTotal === 0)) {
    els.ns5Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">Gün bazlı karşılaştırma için veri bulunamadı.</div></div>';
    return;
  }
  const shortN = (n) => (n.length > 24 ? n.slice(0, 23) + '…' : n);
  renderDayCompIgnoreList(buckets);

  buckets.forEach((b) => {
    if (b.subTotal === 0 && b.nonTotal === 0) return;
    // Yoksayilanlar cikarilir; yuzdeler DEGISMEZ cunku bilesim orani o gunun
    // TUM olay hacmine gore hesaplanir - yoksayma yalnizca gorunumu sadelestirir.
    const visible = b.allRows.filter((r) => !dayCompIgnore.has(r.name)).slice(0, topN);
    b = Object.assign({}, b, { rows: visible });
    const note = b.isAverage
      ? `gün 6–30 toplamı · abone ${b.subUsers.toLocaleString('tr-TR')} kişi / ${b.subTotal.toLocaleString('tr-TR')} olay · abone olmayan ${b.nonUsers.toLocaleString('tr-TR')} kişi / ${b.nonTotal.toLocaleString('tr-TR')} olay`
      : `abone ${b.subUsers.toLocaleString('tr-TR')} kişi / ${b.subTotal.toLocaleString('tr-TR')} olay · abone olmayan ${b.nonUsers.toLocaleString('tr-TR')} kişi / ${b.nonTotal.toLocaleString('tr-TR')} olay`;

    const readNote = b.bucket === 0
      ? 'Y ekseni <b>o grubun o günkü olay hacmine oranıdır</b>, ham sayı değil — grup büyüklükleri çok farklı olduğu için ham sayı karşılaştırılamazdı. Her iki grup da kendi içinde %100\'e normalize edilmiştir. <b>Gün 1 herkesi kapsar</b>; sonraki günlerde yalnızca geri dönenler kalır, çünkü gelmeyenin o gün olayı yoktur.'
      : (b.isAverage
        ? 'Gün 6–30 aralığının tamamı tek grafikte toplanmıştır; yüzdeler bu aralığın toplam hacmine göredir. Bu, uzun vadede yerleşen kullanım alışkanlığını gösterir — ilk günlerin merak trafiği burada sönmüş olur.'
        : 'Aynı ölçüt: her grubun o günkü olay hacmine oran. Bu günde yalnızca <b>o güne kadar geri dönmüş</b> kullanıcılar vardır, dolayısıyla iki grup da giderek daha bağlı kullanıcılardan oluşur.');

    const h = makeChartCard(els.ns5Grid, `${b.label} — en çok yapılan ${b.rows.length} olay`,
      note + (dayCompIgnore.size ? ` · ${dayCompIgnore.size} olay yoksayıldı` : ''), readNote);
    renderGroupedBar(h, b.rows.map((r) => shortN(r.name)),
      { label: 'Abone (pro_success var)', color: PALETTE.cancel, values: b.rows.map((r) => Math.round(r.subPct * 10) / 10) },
      { label: 'Abone olmayan', color: PALETTE.renew, values: b.rows.map((r) => Math.round(r.nonPct * 10) / 10) },
      { pct: true, yLabel: 'O günkü olay hacmine oran (%)', widthPerGroup: 68 });

    makeTableCard(els.ns5Grid, `${b.label} — döküm`,
      'ham sayılar ve yüzdeler yan yana · fark = abone % − abone olmayan %',
      [{ label: 'Event' }, { label: 'Abone %', num: true }, { label: 'Abone n', num: true },
       { label: 'Abone olmayan %', num: true }, { label: 'Abone olmayan n', num: true }, { label: 'Fark', num: true }],
      b.rows.map((r) => {
        const diff = r.subPct - r.nonPct;
        return [
          r.name,
          { v: r.subPct.toFixed(1) + '%', num: true },
          { v: r.subCount.toLocaleString('tr-TR'), num: true },
          { v: r.nonPct.toFixed(1) + '%', num: true },
          { v: r.nonCount.toLocaleString('tr-TR'), num: true },
          { v: (diff >= 0 ? '+' : '') + diff.toFixed(1), num: true, cls: Math.abs(diff) >= 3 ? 'sig' : 'muted' },
        ];
      }), { searchable: true, searchPlaceholder: 'Olay ara…' });
  });
}

// ---------------- render: olay kombinasyonu tablosu ----------------

function renderComboTable(tbl, N) {
  els.cs8Grid.innerHTML = '';
  if (!tbl) {
    els.cs8Grid.innerHTML = '<div class="chart-card"><div class="chart-sub">En az bir olay seç.</div></div>';
    return;
  }
  // En yuksek iptal oranina sahip IKI satiri vurgula (kucuk orneklemliler haric)
  const ranked = tbl.rows.filter((r) => !r.small).slice().sort((a, b) => b.rate - a.rate);
  const topSet = new Set(ranked.slice(0, 2).map((r) => r.label));

  const rows = tbl.rows.map((r) => {
    const liftTxt = r.lift === null ? '—'
      : `${r.lift.toFixed(2)}× (${r.liftLo.toFixed(2)}–${r.liftHi.toFixed(2)})`;
    const top = topSet.has(r.label);
    return [
      { v: r.label + (top ? '  ★' : ''), cls: top ? 'sig' : (r.small ? 'muted' : '') },
      { v: r.n.toLocaleString('tr-TR') + (r.small ? ' ⚠' : ''), num: true, cls: r.small ? 'muted' : '' },
      { v: `${r.rate.toFixed(1)}% (${r.lo.toFixed(0)}–${r.hi.toFixed(0)})`, num: true, cls: top ? 'sig' : (r.small ? 'muted' : '') },
      { v: liftTxt, num: true, cls: top ? 'sig' : (r.small ? 'muted' : '') },
    ];
  });
  makeTableCard(els.cs8Grid, 'Olay kombinasyonu → iptal oranı',
    `son ${N} olay · taban oran %${tbl.baseRate.toFixed(1)} (${tbl.totalCancel.toLocaleString('tr-TR')}/${tbl.total.toLocaleString('tr-TR')}) · ★ = en yüksek iki oran · ⚠ = n<30, orana değil aralığa bak`,
    [{ label: 'Kombinasyon' }, { label: 'Kişi', num: true },
     { label: 'İptal oranı (%95 GA)', num: true }, { label: 'Kat (%95 GA)', num: true }],
    rows);
}

// ================= ABONE OLMAYANLAR: ZAMAN =================

// (a) TAKVIM: kullanicilarin ilk goruldugu tarih dagilimi - edinim egrisi
// (b) KENDI ICINDE: her kullanici kendi ilk gununu 0 kabul ederek, k. gunde
//     hala olay ureten kullanici orani. Bu, takvim etkisinden arindirilmis
//     bir elde tutma egrisi verir.
function computeNonSubTiming(nonSubDays, nonSubSpan, maxRelDay, minSpanDays) {
  const firstDayCounts = new Map(); // absolute day index -> user count
  const relDayUsers = new Array(maxRelDay + 1).fill(0);
  let totalUsers = 0;

  const minSpanSec = (minSpanDays || 0) * SECONDS_PER_DAY;
  let excluded = 0;
  for (const [uid, sp] of nonSubSpan.entries()) {
    const ds = nonSubDays.get(uid);
    if (!ds) continue;
    // Cok kisa sureli kullanicilar egrileri bogdugu icin esik uygulanabiliyor
    if (minSpanSec > 0 && (sp.last - sp.first) < minSpanSec) { excluded++; continue; }
    totalUsers++;
    const firstIdx = Math.floor(sp.first / SECONDS_PER_DAY);
    firstDayCounts.set(firstIdx, (firstDayCounts.get(firstIdx) || 0) + 1);
    for (const d of ds) {
      const rel = d - firstIdx;
      if (rel >= 0 && rel <= maxRelDay) relDayUsers[rel]++;
    }
  }

  const dayIdxs = [...firstDayCounts.keys()].sort((a, b) => a - b);
  const calendar = dayIdxs.map((idx) => ({
    dayIdx: idx,
    date: new Date(idx * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10),
    count: firstDayCounts.get(idx),
  }));

  const relative = relDayUsers.map((n, k) => ({
    day: k, users: n, pct: totalUsers > 0 ? (n / totalUsers) * 100 : 0,
  }));

  return { calendar, relative, totalUsers, excluded, minSpanDays: minSpanDays || 0 };
}

// ================= ABONE OLMAYANLAR: GERI DONENLER =================

// ASIL SORU: abone olmadigi halde ertesi gun geri gelen kullanicilar, ilk
// gunlerinde NE yapmis? Fark yaratan spesifik bir davranis varsa oraya
// kampanya konabilir.
//
// Yontem: her kullanicinin ILK GUNUNDE yaptigi olaylar tespit edilir, sonra
// o olayi yapanlarin geri donus orani, yapmayanlarla karsilastirilir.
// Lift = yapanlarin donus orani / yapmayanlarin donus orani.
function computeNonSubReturn(nonSubDays, nonSubSpan, nonSubUserEvents, maxRelDay, minUsers) {
  const users = [];
  for (const [uid, sp] of nonSubSpan.entries()) {
    const ds = nonSubDays.get(uid);
    if (!ds) continue;
    const firstIdx = Math.floor(sp.first / SECONDS_PER_DAY);
    const evMap = nonSubUserEvents.get(uid) || new Map();
    const day1 = new Set();
    for (const [ev, t] of evMap.entries()) {
      if (Math.floor(t / SECONDS_PER_DAY) === firstIdx) day1.add(ev);
    }
    const activeRel = new Set();
    for (const d of ds) {
      const rel = d - firstIdx;
      if (rel >= 0 && rel <= maxRelDay) activeRel.add(rel);
    }
    users.push({ uid, day1, activeRel, returned2: activeRel.has(1) });
  }

  const total = users.length;
  const returned = users.filter((u) => u.returned2).length;
  const baseRate = total > 0 ? (returned / total) * 100 : 0;

  // olay bazinda donus orani
  const evStats = new Map();
  users.forEach((u) => {
    u.day1.forEach((ev) => {
      let s = evStats.get(ev);
      if (!s) { s = { withN: 0, withRet: 0 }; evStats.set(ev, s); }
      s.withN++;
      if (u.returned2) s.withRet++;
    });
  });

  const rows = [];
  for (const [ev, s] of evStats.entries()) {
    if (s.withN < minUsers) continue;
    const withoutN = total - s.withN;
    const withoutRet = returned - s.withRet;
    const withRate = (s.withRet / s.withN) * 100;
    const withoutRate = withoutN > 0 ? (withoutRet / withoutN) * 100 : 0;
    const ci = wilsonCI(s.withRet, s.withN);
    rows.push({
      name: ev, withN: s.withN, withRet: s.withRet, withRate,
      withoutN, withoutRate,
      lift: withoutRate > 0 ? withRate / withoutRate : null,
      lo: ci.lo, hi: ci.hi,
    });
  }
  rows.sort((a, b) => (b.lift === null ? -1 : b.lift) - (a.lift === null ? -1 : a.lift));

  // MATRIS: ilk gun olayi x sonraki gunler -> o gun aktif olma orani
  const topEvents = rows.slice(0, 12).map((r) => r.name);
  const matrix = topEvents.map((ev) => {
    const subset = users.filter((u) => u.day1.has(ev));
    const cells = [];
    for (let k = 1; k <= maxRelDay; k++) {
      const n = subset.filter((u) => u.activeRel.has(k)).length;
      cells.push({ day: k, pct: subset.length > 0 ? (n / subset.length) * 100 : 0, n });
    }
    return { name: ev, total: subset.length, cells };
  });

  // temel satir (tum kullanicilar)
  const baseline = [];
  for (let k = 1; k <= maxRelDay; k++) {
    const n = users.filter((u) => u.activeRel.has(k)).length;
    baseline.push({ day: k, pct: total > 0 ? (n / total) * 100 : 0, n });
  }

  return { total, returned, baseRate, rows, matrix, baseline, maxRelDay };
}

// ================= GUN BAZLI OLAY BILESIMI =================

// Her kova icin iki grubun en cok yaptigi olaylar. Grup buyuklukleri cok
// farkli oldugu icin HAM SAYI karsilastirilamaz; bunun yerine her grubun
// KENDI o gunku olay hacmine orani (bilesim yuzdesi) kullaniliyor - iki
// grup da %100'e normalize edildiginden dogrudan karsilastirilabilir.
//
// Ust siralama, iki grubun bilesim yuzdelerinin TOPLAMINA gore yapilir;
// boylece yalnizca bir grupta baskin olan olaylar da listeye girer.
function computeDayComposition(dayComp, dayCompUsers, topN) {
  const LABELS = ['Gün 1', 'Gün 2', 'Gün 3', 'Gün 4', 'Gün 5', 'Gün 6–30'];
  const out = [];

  for (let b = 0; b < 6; b++) {
    const subMap = dayComp.sub[b], nonMap = dayComp.non[b];
    let subTotal = 0, nonTotal = 0;
    for (const v of subMap.values()) subTotal += v;
    for (const v of nonMap.values()) nonTotal += v;

    const names = new Set([...subMap.keys(), ...nonMap.keys()]);
    const rows = [...names].map((nm) => {
      const sc = subMap.get(nm) || 0, nc = nonMap.get(nm) || 0;
      return {
        name: nm, subCount: sc, nonCount: nc,
        subPct: subTotal > 0 ? (sc / subTotal) * 100 : 0,
        nonPct: nonTotal > 0 ? (nc / nonTotal) * 100 : 0,
      };
    });
    rows.sort((a, b2) => (b2.subPct + b2.nonPct) - (a.subPct + a.nonPct));

    out.push({
      label: LABELS[b], bucket: b,
      rows: rows.slice(0, topN), allRows: rows,
      subTotal, nonTotal,
      subUsers: dayCompUsers.sub[b].size,
      nonUsers: dayCompUsers.non[b].size,
      isAverage: b === 5,
    });
  }
  return out;
}

// ================= YENIDEN ETIKETLEME (yanlis siniflandirma duzeltmesi) =================
// nsIgnore/dayCompIgnore sadece GORUNUMU filtreler (compute'a girmeden once
// hesaplanmis satirlari eler). Bu ise tam tersi bir noktada calisir: isaretli
// bir event'i yapan HERHANGI bir "abone olmayan" etiketli kullanici, compute
// fonksiyonlarina girmeden ONCE tum non-sub Map/Set'lerinden cikarilir - yani
// o kullanici bu sekmede hic yokmus gibi davranilir (aslinda abone sayilir).
const nsReclassify = new Set();

function renderReclassifyList(eventCounts, excludedCount) {
  const box = els.nsReclassifyBox;
  if (!box) return;
  const rows = [...eventCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);
  box.innerHTML = '';
  if (nsReclassify.size > 0) {
    const note = document.createElement('div');
    note.className = 'ctrl-hint';
    note.style.marginBottom = '6px';
    note.textContent = `${(excludedCount || 0).toLocaleString('tr-TR')} kullanıcı abone sayılıp bu sekmeden çıkarıldı`;
    box.appendChild(note);
  }
  rows.forEach((r) => {
    const lab = document.createElement('label');
    lab.className = 'filter-item';
    const checked = nsReclassify.has(r.name) ? ' checked' : '';
    lab.innerHTML = `<input type="checkbox"${checked} data-ev="${escapeAttr(r.name)}">` +
      `<span class="fname">${escapeXml(r.name)}</span>` +
      `<span class="fcount">${r.count.toLocaleString('tr-TR')}</span>`;
    box.appendChild(lab);
  });
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('change', (ev) => {
      const cb = ev.target;
      if (!cb || !cb.dataset || !cb.dataset.ev) return;
      if (cb.checked) nsReclassify.add(cb.dataset.ev); else nsReclassify.delete(cb.dataset.ev);
      try { runFilteredAnalysis(); } catch (err) { console.error(err); }
    });
  }
}

// nsReclassify'da isaretli event'lerden en az birini yapan tum non-sub
// kullanicilarin uid'lerini dondurur.
function computeReclassifyExclusion(nonSubEventUsers, reclassifySet) {
  const out = new Set();
  for (const ev of reclassifySet) {
    const users = nonSubEventUsers.get(ev);
    if (!users) continue;
    for (const uid of users) out.add(uid);
  }
  return out;
}

// excludeUids'daki kullanicilari non-sub Map'lerinden cikarir. nonSubEventCounts
// (event -> TOPLAM olay sayisi, kullanici bazinda degil) kasitli olarak
// disaride tutuldu: pass2 sirasinda kullanici ayriminda tutulmuyor, o yuzden
// yalniz "toplam olay" / kisi-basi-ortalama gibi ikincil rakamlarda kucuk bir
// yaklastirma kalir - kullanici sayilari ve oranlari (asil metrikler) tam dogru.
function filterNonSubByExclusion(nonSubEventUsers, nonSubDays, nonSubSpan, nonSubUserEvents, excludeUids) {
  if (excludeUids.size === 0) {
    return { nonSubEventUsers, nonSubDays, nonSubSpan, nonSubUserEvents };
  }
  const filterUidMap = (m) => {
    const out = new Map();
    for (const [uid, v] of m.entries()) if (!excludeUids.has(uid)) out.set(uid, v);
    return out;
  };
  const filteredEventUsers = new Map();
  for (const [ev, users] of nonSubEventUsers.entries()) {
    const filtered = new Set([...users].filter((uid) => !excludeUids.has(uid)));
    if (filtered.size > 0) filteredEventUsers.set(ev, filtered);
  }
  return {
    nonSubEventUsers: filteredEventUsers,
    nonSubDays: filterUidMap(nonSubDays),
    nonSubSpan: filterUidMap(nonSubSpan),
    nonSubUserEvents: filterUidMap(nonSubUserEvents),
  };
}

const nsIgnore = new Set();

function renderIgnoreList(compare) {
  const box = els.nsIgnoreBox;
  if (!box) return;
  box.innerHTML = '';
  const items = compare.slice(0, 60);
  items.forEach((e) => {
    const lab = document.createElement('label');
    lab.className = 'filter-item';
    const checked = nsIgnore.has(e.name) ? ' checked' : '';
    lab.innerHTML = `<input type="checkbox"${checked} data-ev="${escapeAttr(e.name)}">` +
      `<span class="fname">${escapeXml(e.name)}</span>` +
      `<span class="fcount">${e.nonSubUsers.toLocaleString('tr-TR')}</span>`;
    box.appendChild(lab);
  });
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('change', (ev) => {
      const cb = ev.target;
      if (!cb || !cb.dataset || !cb.dataset.ev) return;
      if (cb.checked) nsIgnore.add(cb.dataset.ev); else nsIgnore.delete(cb.dataset.ev);
      try { runFilteredAnalysis(); } catch (err) { console.error(err); }
    });
  }
}

