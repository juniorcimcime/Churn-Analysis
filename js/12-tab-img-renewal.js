// ================= GÖRSEL SAYISI -> YENİLEME =================
//
// x (görsel sayısı) HER ZAMAN ham discrete tam sayı olarak kullanılır - log
// donusumu veya winsorize YOK. Aykiri kullanicilar (cok yuksek uretim) modelden
// atilmiyor; sadece dustukleri grup kucuk n'li oldugu icin grafikte soluk
// isaretleniyor (bkz. buildImageCountBuckets + computeImageCountRenewalAnalysis).

// Sabit alt gruplar (0,1,2-3,4-6,7-10) + veri dagilimina gore ayarlanan bir
// kuyruk grubu: kuyrukta (n>=11) yeterince kullanici varsa (>=30), p90'a
// gore ikiye bolunur - aksi halde tek "11+" grubu yeterlidir.
function buildImageCountBuckets(allCounts) {
  const base = [
    { key: '0', lo: 0, hi: 0 },
    { key: '1', lo: 1, hi: 1 },
    { key: '2-3', lo: 2, hi: 3 },
    { key: '4-6', lo: 4, hi: 6 },
    { key: '7-10', lo: 7, hi: 10 },
  ];
  const tail = allCounts.filter((n) => n >= 11);
  let tailDefs;
  if (tail.length < 30) {
    tailDefs = [{ key: '11+', lo: 11, hi: Infinity }];
  } else {
    const sorted = [...tail].sort((a, b) => a - b);
    const cut = Math.max(15, Math.round(percentile(sorted, 90)));
    tailDefs = [
      { key: `11-${cut}`, lo: 11, hi: cut },
      { key: `${cut + 1}+`, lo: cut + 1, hi: Infinity },
    ];
  }
  return [...base, ...tailDefs].map((b) => ({ ...b, label: b.key, test: (n) => n >= b.lo && n <= b.hi }));
}

// countMap: uid -> görsel sayısı.
function computeImageCountRenewalAnalysis(renewalT0, cancelT0, countMap) {
  const users = [];
  for (const uid of renewalT0.keys()) users.push({ uid, n: countMap.get(uid) || 0, isCancel: 0 });
  for (const uid of cancelT0.keys()) users.push({ uid, n: countMap.get(uid) || 0, isCancel: 1 });

  const buckets = buildImageCountBuckets(users.map((u) => u.n));
  const stats = new Map(buckets.map((b) => [b.key, { total: 0, cancelled: 0, sumN: 0 }]));
  users.forEach((u) => {
    const b = buckets.find((x) => x.test(u.n));
    if (!b) return;
    const s = stats.get(b.key);
    s.total++;
    if (u.isCancel) s.cancelled++;
    s.sumN += u.n;
  });

  const bucketRows = buckets.map((b) => {
    const s = stats.get(b.key);
    const ci = wilsonCI(s.cancelled, s.total);
    return {
      key: b.key, label: b.label, total: s.total, cancelled: s.cancelled,
      avgN: s.total > 0 ? s.sumN / s.total : 0,
      lowN: s.total < 30,
      countLo: b.lo, countHi: b.hi,
      ...ci,
    };
  }).filter((r) => r.total > 0);

  // Lojistik regresyon: x HAM discrete sayı olarak girer (logisticRegression
  // sayısal kararlılık için içeride standartlaştırıyor, ama bu x'i değiştirmez -
  // katsayı '1 SD başına' olarak raporlanır, kodun genelindeki mevcut yaklaşım).
  const X = users.map((u) => [u.n]);
  const y = users.map((u) => u.isCancel);
  const fit = logisticRegression(X, y, ['Görsel sayısı']);

  const curvePoints = fit
    ? bucketRows.map((r) => ({ x: r.key, n: r.avgN, y: scoreLogistic(fit, [r.avgN]) * 100 }))
    : [];

  // CART tek-split: görsel sayısı üzerinde TEK eşik. minLeaf=30, tabloda
  // 'küçük örneklem' eşiğiyle (n<30) aynı - tutarlı bir eşik.
  const tree = buildDecisionTree(X, y, { maxDepth: 1, minLeaf: 30, featureNames: ['Görsel sayısı'] });
  const split = (tree && !tree.leaf) ? {
    threshold: Math.floor(tree.threshold),
    below: { n: tree.left.n, rate: tree.left.rate },
    above: { n: tree.right.n, rate: tree.right.rate },
  } : null;

  return {
    bucketRows, fit, curvePoints, split,
    totalUsers: users.length, totalCancel: users.reduce((a, u) => a + u.isCancel, 0),
  };
}

// ---------------- render: özel SVG - kova+CI çubukları + lojistik eğri + eşik çizgisi ----------------
// svgBarChartCI'nin eksen/whisker mantığını temel alır ama üzerine model
// eğrisi ve CART eşiğini bindirir - bu ikisini destekleyen ortak bir fonksiyon
// olmadığı için (ve diğer 6-7 sekmenin kullandığı svgBarChartCI'ye dokunmamak
// için) bu grafik bilerek bu dosyaya özel tutuluyor.
function svgImageRenewalChart(bucketRows, curvePoints, split, opts = {}) {
  const W = 460;
  const H = 260 + (opts.xLabel ? 14 : 0);
  const padLeft = 38 + (opts.yLabel ? 16 : 0), padRight = 14, padTop = 18;
  const padBottom = 46 + (opts.xLabel ? 14 : 0);
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  if (!bucketRows || bucketRows.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">
      <text x="${W / 2}" y="${H / 2}" font-size="11" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">veri yok</text></svg>`;
  }

  const maxHi = maxOf([...bucketRows.map((p) => p.hi), ...curvePoints.map((p) => p.y)], 1);
  const yMax = opts.yMax !== undefined ? opts.yMax : Math.min(100, maxHi * 1.25);

  let grid = '';
  const nGrid = 4;
  for (let g = 0; g <= nGrid; g++) {
    const gy = padTop + plotH - (g / nGrid) * plotH;
    grid += `<line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${W - padRight}" y2="${gy.toFixed(1)}" stroke="${PALETTE.grid}" stroke-width="1"/>`;
    grid += `<text x="${padLeft - 6}" y="${(gy + 3).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace">${Math.round((g / nGrid) * yMax)}%</text>`;
  }

  const n = bucketRows.length;
  const gap = 16;
  const barW = Math.max(6, (plotW - gap * (n - 1)) / n);
  const yOf = (v) => padTop + plotH - (v / yMax) * plotH;
  const centerOf = (i) => padLeft + i * (barW + gap) + barW / 2;

  let body = '';
  bucketRows.forEach((p, i) => {
    const x = padLeft + i * (barW + gap);
    const cx = centerOf(i);
    const yBar = yOf(p.p);
    const barH = Math.max(0, padTop + plotH - yBar);
    const opacity = p.lowN ? 0.45 : 1;

    body += `<rect x="${x.toFixed(1)}" y="${yBar.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${opts.color || PALETTE.renew}" opacity="${opacity}" rx="2"/>`;

    const yLo = yOf(p.lo), yHi = yOf(p.hi);
    const capW = Math.min(10, barW * 0.4);
    body += `<line x1="${cx.toFixed(1)}" y1="${yHi.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yLo.toFixed(1)}" stroke="${PALETTE.text}" stroke-width="1.4" opacity="${opacity}"/>`;
    body += `<line x1="${(cx - capW / 2).toFixed(1)}" y1="${yHi.toFixed(1)}" x2="${(cx + capW / 2).toFixed(1)}" y2="${yHi.toFixed(1)}" stroke="${PALETTE.text}" stroke-width="1.4" opacity="${opacity}"/>`;
    body += `<line x1="${(cx - capW / 2).toFixed(1)}" y1="${yLo.toFixed(1)}" x2="${(cx + capW / 2).toFixed(1)}" y2="${yLo.toFixed(1)}" stroke="${PALETTE.text}" stroke-width="1.4" opacity="${opacity}"/>`;

    body += `<text x="${cx.toFixed(1)}" y="${(yHi - 6).toFixed(1)}" font-size="10" fill="${PALETTE.text}" text-anchor="middle" font-family="ui-monospace, monospace" opacity="${opacity}">${p.p.toFixed(1)}%${p.lowN ? '†' : ''}</text>`;
    body += `<text x="${cx.toFixed(1)}" y="${(padTop + plotH + 14).toFixed(1)}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(p.label)}</text>`;
    body += `<text x="${cx.toFixed(1)}" y="${(padTop + plotH + 26).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">n=${p.total.toLocaleString('tr-TR')}</text>`;
  });

  // lojistik regresyon egrisi: kova merkezlerinden gecen kirik cizgi
  if (curvePoints.length > 0) {
    let d = '';
    curvePoints.forEach((cp, i) => {
      const cx = centerOf(i), cy = yOf(Math.min(cp.y, yMax));
      d += `${i === 0 ? 'M' : ' L'} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    });
    body += `<path d="${d}" fill="none" stroke="${PALETTE.brass || PALETTE.cancelLight}" stroke-width="2" stroke-dasharray="1 0"/>`;
    curvePoints.forEach((cp, i) => {
      body += `<circle cx="${centerOf(i).toFixed(1)}" cy="${yOf(Math.min(cp.y, yMax)).toFixed(1)}" r="2.8" fill="${PALETTE.brass || PALETTE.cancelLight}"/>`;
    });
  }

  // CART esik cizgisi: esigin dustugu kovanin SOL kenarina dikey kesik cizgi
  if (split) {
    const boundaryIdx = bucketRows.findIndex((r) => r.countLo > split.threshold);
    if (boundaryIdx > 0) {
      const bx = padLeft + boundaryIdx * (barW + gap) - gap / 2;
      body += `<line x1="${bx.toFixed(1)}" y1="${padTop}" x2="${bx.toFixed(1)}" y2="${(padTop + plotH)}" stroke="${PALETTE.cancel}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
      body += `<text x="${bx.toFixed(1)}" y="${padTop - 5}" font-size="9" fill="${PALETTE.cancel}" text-anchor="middle" font-family="ui-monospace, monospace">eşik: ${split.threshold}</text>`;
    }
  }

  const legendY = padTop + 10;
  let legend = `<circle cx="${W - padRight - 70}" cy="${legendY}" r="2.8" fill="${PALETTE.brass || PALETTE.cancelLight}"/>`;
  legend += `<text x="${W - padRight - 63}" y="${(legendY + 3).toFixed(1)}" font-size="8.5" fill="${PALETTE.textDim}" font-family="ui-monospace, monospace">model tahmini</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img">${grid}${body}${legend}${axisLabels(W, H, padLeft, padTop, plotW, plotH, opts)}</svg>`;
}

function renderImageRenewalChart(holder, analysis, opts = {}) {
  holder.innerHTML = svgImageRenewalChart(analysis.bucketRows, analysis.curvePoints, analysis.split, opts);
}

function splitSentence(analysis) {
  if (!analysis.split) return 'Veride, cancel oranını belirgin şekilde ayıran tek bir üretim sayısı eşiği bulunamadı.';
  const s = analysis.split;
  return `${s.threshold} veya daha az üreten kullanıcılarda cancel oranı %${s.below.rate.toFixed(1)} (n=${s.below.n.toLocaleString('tr-TR')}), ` +
    `${s.threshold + 1} ve üzeri üretenlerde %${s.above.rate.toFixed(1)} (n=${s.above.n.toLocaleString('tr-TR')}).`;
}

// analysis: computeImageCountRenewalAnalysis çıktısı (toplam görsel sayısı üzerinden).
function renderImageRenewal(analysis) {
  if (!els.imgRenewalGrid) return;
  els.imgRenewalGrid.innerHTML = '';
  if (!analysis) return;

  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML = `<h2><b>İlk 7 gündeki görsel sayısına göre cancel oranı</b></h2><span class="note">n=${analysis.totalUsers.toLocaleString('tr-TR')} · cancel=${analysis.totalCancel.toLocaleString('tr-TR')}</span>`;
  els.imgRenewalGrid.appendChild(head);

  const g1 = makeChartCard(els.imgRenewalGrid, 'Üretim sayısına göre cancel oranı', splitSentence(analysis),
    'Çubuklar: her gruptaki gerçek cancel oranı. İnce dikey çizgiler: %95 güven aralığı (gerçek oranın muhtemelen bu bant içinde olduğunu gösterir) — n&lt;30 olan gruplar † ile işaretli ve soluk, dikkatli yorumla. Kesikli sarı çizgi: modelin tahmin ettiği olasılık eğrisi. Kırmızı kesikli çizgi: cancel oranının en belirgin değiştiği eşik nokta.');
  renderImageRenewalChart(g1, analysis, { xLabel: 'Görsel sayısı', yLabel: 'Cancel oranı (%)' });
}
