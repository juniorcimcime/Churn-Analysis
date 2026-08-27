// GUN 1 -> GUN 2 GECIS ORANI: her user'in gun 1 sonunda (hesapta) kalan
// MINIMUM coin miktarina gore 10'luk (varsayilan bucketWidth) dilimlere
// ayrilir, ve o dilimdeki userlarin YUZDE KACI gun 2'de de en az bir olay
// uretmis (activeDaysSet'te gun 2 var) hesaplanir. dayCoinRange zaten Pass 2'de
// TUM gunler icin tutuldugu icin, gun 1'in kendi min/max araligina buradan
// erisiliyor - ekstra dosya taramasi gerekmiyor.
function computeDay1CoinToDay2Return(t0Lookup, dayCoinRange, activeDaysSet, bucketWidth) {
  const bucketTotals = new Map(); // bucketStart -> {total, returned}
  for (const uid of t0Lookup.keys()) {
    const perDay = dayCoinRange.get(uid);
    const day1Range = perDay ? perDay.get(1) : undefined;
    if (!day1Range) continue;
    const remaining = day1Range.min;
    const bucketStart = Math.floor(remaining / bucketWidth) * bucketWidth;
    if (!bucketTotals.has(bucketStart)) bucketTotals.set(bucketStart, { total: 0, returned: 0 });
    const b = bucketTotals.get(bucketStart);
    b.total++;
    const days = activeDaysSet.get(uid);
    if (days && days.has(2)) b.returned++;
  }
  return [...bucketTotals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, { total, returned }]) => ({ x, pct: total > 0 ? (returned / total) * 100 : 0, n: total }));
}

// GUN 2'DE KALAN COIN -> GUN 2'DE CANCEL ETME ORANI: sadece gun 2'de
// uygulamaya GIREN (activeDaysSet'te gun 2 olan) kullanicilar arasinda,
// GUN 2 ICINDE gordukleri MINIMUM coin miktarina (yani o gun hesapta kalan
// en dusuk bakiye) gore 10'luk dilimlere ayrilir, ve o dilimdeki
// kullanicilarin YUZDE KACININ CANCEL EVENT'I TAM OLARAK GUN 2'DE
// gerceklestigi hesaplanir. Bu, "gun 2'ye girip coini kalmadigini gorunce
// hemen cancel etme" trendini nicel olarak gostermek icin tasarlandi.
// Populasyon TUM userlar (renewal+cancel grubu birlestirilmis) - grup
// ayrimi burada yapilmiyor cunku soru grup tanimindan bagimsiz.
function computeDay2CoinToCancelRate(t0Lookup, dayCoinRange, activeDaysSet, cancelTimeLookup, bucketWidth) {
  const buckets = new Map(); // bucketStart -> {total, cancelled}
  for (const [uid, t0] of t0Lookup.entries()) {
    const days = activeDaysSet.get(uid);
    if (!days || !days.has(2)) continue; // sadece gun2'de uygulamaya girenler

    const perDay = dayCoinRange.get(uid);
    const day2Range = perDay ? perDay.get(2) : undefined;
    if (!day2Range) continue; // gun 2'de coin verisi yoksa hesaba giremez

    const remaining = day2Range.min;
    const bucketStart = Math.floor(remaining / bucketWidth) * bucketWidth;
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, { total: 0, cancelled: 0 });
    const b = buckets.get(bucketStart);
    b.total++;

    const tCancel = cancelTimeLookup.get(uid);
    if (tCancel !== undefined && dayNumberUTC(tCancel, t0) === 2) b.cancelled++;
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, { total, cancelled }]) => ({ x, pct: total > 0 ? (cancelled / total) * 100 : 0, n: total }));
}

// ---------------- render: gün1 coin -> gün2 dönüş scatter ----------------

function renderScatterVisual(renewalPoints, cancelPoints) {
  els.scatterGrid.innerHTML = '';

  const c1 = makeChartCard(els.scatterGrid, 'Renewal — Gün 1 Coin → Gün 2 Dönüş', `bucket sayısı=${renewalPoints.length} · toplam n=${renewalPoints.reduce((a, p) => a + p.n, 0).toLocaleString('tr-TR')}`,
    'Her nokta bir coin dilimi. x=0 → gün 1 sonunda 0-9 coini kalanlar; y → bunların yüzde kaçı gün 2\'de geri döndü.');
  renderScatter(c1, renewalPoints, PALETTE.renew, { xLabel: 'Gün 1 sonunda kalan coin', yLabel: 'Gün 2\'ye dönüş oranı (%)' });

  const c2 = makeChartCard(els.scatterGrid, 'Cancel — Gün 1 Coin → Gün 2 Dönüş', `bucket sayısı=${cancelPoints.length} · toplam n=${cancelPoints.reduce((a, p) => a + p.n, 0).toLocaleString('tr-TR')}`,
    'Aynı ölçüt, iptal grubu için. Sola doğru düşen eğri "coini bitenler geri dönmüyor" demektir.');
  renderScatter(c2, cancelPoints, PALETTE.cancel, { xLabel: 'Gün 1 sonunda kalan coin', yLabel: 'Gün 2\'ye dönüş oranı (%)' });
}

// ---------------- render: gün1 coin -> gün2'de CANCEL etme orani ----------------

function renderDay2CancelRateVisual(points) {
  els.day2CancelGrid.innerHTML = '';
  // X ekseni 0-200 ile sinirli: sadece GORUNTULEME araligi, veri filtresi degil -
  // points'in tamami (200 ustu dilimler dahil) hesaplamaya girmeye devam eder,
  // renderScatter bu araligin disindaki noktalari yalnizca CIZMEZ.
  const c1 = makeChartCard(els.day2CancelGrid, 'Gün 2\'de Kalan Coin → Gün 2\'de Cancel Etme Oranı', `bucket sayısı=${points.length} · toplam n=${points.reduce((a, p) => a + p.n, 0).toLocaleString('tr-TR')} (gün 2'de uygulamaya girip coin verisi olan tüm kullanıcılar) · eksen 0-200 ile sınırlı`,
    'Sola doğru yükselen eğri, "gün 2\'de coinin dibini görünce hemen iptal etme" davranışının kanıtıdır. Düz eğri = böyle bir eğilim yok.');
  renderScatter(c1, points, PALETTE.cancel, { xLabel: 'Gün 2\'de kalan coin', yLabel: 'Gün 2\'de iptal oranı (%)', xMin: 0, xMax: 200 });
}

