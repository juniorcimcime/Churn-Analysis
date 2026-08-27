// ---------------- SVG bar chart (Chart.js YOK, sifir dis bagimlilik) ----------------

function svgBarChart(labels, values, colors, opts = {}) {
  // widthPerBar verilirse grafik cubuk sayisina gore GENISLER; disaridaki
  // kapsayici yatay kaydirilir. Boylece cok bin'li histogramlarda etiketler
  // ust uste binmez ve 5-10-15 gibi degerler tek tek okunabilir.
  const W = opts.widthPerBar
    ? Math.max(420, 16 + (opts.yLabel ? 16 : 0) + 8 + labels.length * opts.widthPerBar)
    : 420;
  // rotateLabels: uzun event/tur adlari yatay yazilinca ust uste biner;
  // -45 derece cevirip alt bosluğu buyutuyoruz.
  const rot = !!opts.rotateLabels;
  const H = 230 + (opts.xLabel ? 14 : 0) + (rot ? 70 : 0);
  const padLeft = 8 + (opts.yLabel ? 16 : 0), padRight = 8, padTop = 22;
  const padBottom = 26 + (opts.xLabel ? 14 : 0) + (rot ? 70 : 0);
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const rawMax = maxOf(values, 0);
  const maxVal = opts.yMax !== undefined ? opts.yMax : (rawMax > 0 ? rawMax * 1.18 : 1);
  const n = labels.length;
  const gap = 6;
  const barW = Math.max(2, (plotW - gap * (n - 1)) / n);

  let grid = '';
  const nGrid = 3;
  for (let g = 0; g <= nGrid; g++) {
    const gy = padTop + plotH - (g / nGrid) * plotH;
    grid += `<line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${W - padRight}" y2="${gy.toFixed(1)}" stroke="${PALETTE.grid}" stroke-width="1"/>`;
  }

  let bars = '';
  let labelsSvg = '';
  values.forEach((v, i) => {
    // v === null/undefined -> "hic gozlem yok" (ornegin bir gun kovasina hic
    // kullanici dusmedi), v === 0 -> "gozlem var, deger gercekten sifir".
    // Ikisini AYNI gorsel (yukseklik 0, etiketsiz) olarak cizmek "veri yok"u
    // "medyan 0"dan ayirt edilemez yapardi - o yuzden ayri isaretleniyor.
    const noData = v === null || v === undefined;
    const barH = !noData && maxVal > 0 ? Math.max(0, (v / maxVal) * plotH) : 0;
    const x = padLeft + i * (barW + gap);
    const y = padTop + (plotH - barH);
    const color = Array.isArray(colors) ? colors[i] : colors;
    if (!noData) {
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"></rect>`;
    }
    if (noData) {
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(padTop + plotH - 5).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace" opacity="0.7">veri yok</text>`;
    } else if (v !== 0) {
      const labelText = Number.isInteger(v) ? v.toLocaleString('tr-TR') : v.toFixed(1);
      const ly = Math.max(10, y - 5);
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${ly.toFixed(1)}" font-size="9.5" fill="${PALETTE.text}" text-anchor="middle" font-family="ui-monospace, monospace">${labelText}</text>`;
    }
    // sparseLabels: x ekseni karmasiklasmasin diye SADECE ilk ve son bar'a
    // etiket yaziliyor (histogram gibi cok-bin'li grafiklerde mid degerler
    // kalabalik ve okunmasi zor oluyor).
    const stride = opts.labelStride || 1;
    const showLabel = opts.sparseLabels
      ? (i === 0 || i === n - 1)
      : (stride <= 1 || i % stride === 0 || i === 0 || i === n - 1);
    if (showLabel) {
      const lx = x + barW / 2, ly = padTop + plotH + (rot ? 12 : 16);
    labelsSvg += rot
      ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace" transform="rotate(-45 ${lx.toFixed(1)} ${ly.toFixed(1)})">${escapeXml(String(labels[i]))}</text>`
      : `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="10.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(String(labels[i]))}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;" role="img">
    ${grid}
    ${bars}
    ${labelsSvg}
    ${axisLabels(W, H, padLeft, padTop, plotW, plotH, opts)}
  </svg>`;
}

// Eksen basliklari: y ekseni dondurulmus, x ekseni altta ortali.
function axisLabels(W, H, plotLeft, plotTop, plotW, plotH, opts) {
  let out = '';
  if (opts.xLabel) {
    out += `<text x="${(plotLeft + plotW / 2).toFixed(1)}" y="${H - 2}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(opts.xLabel)}</text>`;
  }
  if (opts.yLabel) {
    const cy = plotTop + plotH / 2;
    out += `<text x="10" y="${cy.toFixed(1)}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace" transform="rotate(-90 10 ${cy.toFixed(1)})">${escapeXml(opts.yLabel)}</text>`;
  }
  return out;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeChartCard(container, title, sub, readNote) {
  const card = document.createElement('div');
  card.className = 'chart-card';
  card.innerHTML = `<h3>${title}</h3><div class="chart-sub">${sub}</div><div class="chart-svg-holder"></div>` +
    (readNote ? `<div class="read-note"><b>Nasıl okunur:</b> ${readNote}</div>` : '');
  container.appendChild(card);
  return card.querySelector('.chart-svg-holder');
}

function renderBar(holder, labels, values, colors, opts = {}) {
  const svg = svgBarChart(labels, values, colors, opts);
  if (opts.widthPerBar) {
    const minW = Math.max(420, labels.length * opts.widthPerBar);
    holder.innerHTML = `<div class="scroll-x"><div style="min-width:${minW}px">${svg}</div></div>`;
  } else {
    holder.innerHTML = svg;
  }
}

// ---------------- SVG scatter chart (gun1 coin -> gun2 donus orani icin) ----------------

function svgScatterChart(points, color, opts = {}) {
  const W = 420;
  const H = 230 + (opts.xLabel ? 14 : 0);
  const padLeft = 34 + (opts.yLabel ? 16 : 0), padRight = 10, padTop = 22;
  const padBottom = 30 + (opts.xLabel ? 14 : 0);
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  if (!points || points.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
      <text x="${W / 2}" y="${H / 2}" font-size="11" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">veri yok</text>
    </svg>`;
  }

  // xMin/xMax verilirse eksen bu araliga SABITLENIR (görüntüleme sınırı) ve
  // bu aralığın dışında kalan noktalar sadece ÇİZİLMEZ - points dizisi
  // (ve dolayısıyla dışarıdaki tüm hesaplamalar) değişmeden kalır.
  const xs = points.map((p) => p.x);
  const minX = opts.xMin !== undefined ? opts.xMin : minOf(xs);
  const maxX = opts.xMax !== undefined ? opts.xMax : maxOf(xs);
  const xRange = maxX - minX || 1;
  const visiblePoints = (opts.xMin !== undefined || opts.xMax !== undefined)
    ? points.filter((p) => p.x >= minX && p.x <= maxX)
    : points;

  // y ekseni sabit 0-100%
  let grid = '';
  const nGridY = 4;
  for (let g = 0; g <= nGridY; g++) {
    const gy = padTop + plotH - (g / nGridY) * plotH;
    const label = `${Math.round((g / nGridY) * 100)}%`;
    grid += `<line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${W - padRight}" y2="${gy.toFixed(1)}" stroke="${PALETTE.grid}" stroke-width="1"/>`;
    grid += `<text x="${(padLeft - 6).toFixed(1)}" y="${(gy + 3).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace">${label}</text>`;
  }

  const n = visiblePoints.length;
  const stride = opts.labelStride || autoStride(n, 12);

  let dots = '';
  let xLabels = '';
  visiblePoints.forEach((p, i) => {
    const xPos = padLeft + (xRange === 0 ? plotW / 2 : ((p.x - minX) / xRange) * plotW);
    const yPos = padTop + plotH - (p.pct / 100) * plotH;
    dots += `<circle cx="${xPos.toFixed(1)}" cy="${yPos.toFixed(1)}" r="4.5" fill="${color}" opacity="0.85"></circle>`;
    dots += `<text x="${xPos.toFixed(1)}" y="${(yPos - 8).toFixed(1)}" font-size="8.5" fill="${PALETTE.text}" text-anchor="middle" font-family="ui-monospace, monospace">${Math.round(p.pct)}%</text>`;

    const showLabel = stride <= 1 || i % stride === 0 || i === 0 || i === n - 1;
    if (showLabel) {
      xLabels += `<text x="${xPos.toFixed(1)}" y="${(padTop + plotH + 16).toFixed(1)}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${p.x}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;" role="img">
    ${grid}
    ${dots}
    ${xLabels}
    ${axisLabels(W, H, padLeft, padTop, plotW, plotH, opts)}
  </svg>`;
}

function renderScatter(holder, points, color, opts = {}) {
  holder.innerHTML = svgScatterChart(points, color, opts);
}

// ---------------- SVG bar chart + %95 guven araligi cubuklari ----------------

function svgBarChartCI(points, color, opts = {}) {
  const W = 440;
  const H = 250 + (opts.xLabel ? 14 : 0);
  const padLeft = 38 + (opts.yLabel ? 16 : 0), padRight = 10, padTop = 18;
  const padBottom = 46 + (opts.xLabel ? 14 : 0);
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  if (!points || points.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">
      <text x="${W / 2}" y="${H / 2}" font-size="11" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">veri yok</text></svg>`;
  }

  const maxHi = maxOf(points.map((p) => p.hi), 1);
  const yMax = opts.yMax !== undefined ? opts.yMax : Math.min(100, maxHi * 1.25);

  let grid = '';
  const nGrid = 4;
  for (let g = 0; g <= nGrid; g++) {
    const gy = padTop + plotH - (g / nGrid) * plotH;
    grid += `<line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${W - padRight}" y2="${gy.toFixed(1)}" stroke="${PALETTE.grid}" stroke-width="1"/>`;
    grid += `<text x="${padLeft - 6}" y="${(gy + 3).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace">${Math.round((g / nGrid) * yMax)}%</text>`;
  }

  const n = points.length;
  const gap = 16;
  const barW = Math.max(6, (plotW - gap * (n - 1)) / n);
  const yOf = (v) => padTop + plotH - (v / yMax) * plotH;

  let body = '';
  points.forEach((p, i) => {
    const x = padLeft + i * (barW + gap);
    const cx = x + barW / 2;
    const yBar = yOf(p.p);
    const barH = Math.max(0, padTop + plotH - yBar);
    const barColor = Array.isArray(color) ? color[i] : color;

    body += `<rect x="${x.toFixed(1)}" y="${yBar.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${barColor}" rx="2"/>`;

    // guven araligi cubugu (whisker)
    const yLo = yOf(p.lo);
    const yHi = yOf(p.hi);
    const capW = Math.min(10, barW * 0.4);
    body += `<line x1="${cx.toFixed(1)}" y1="${yHi.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yLo.toFixed(1)}" stroke="${PALETTE.text}" stroke-width="1.4"/>`;
    body += `<line x1="${(cx - capW / 2).toFixed(1)}" y1="${yHi.toFixed(1)}" x2="${(cx + capW / 2).toFixed(1)}" y2="${yHi.toFixed(1)}" stroke="${PALETTE.text}" stroke-width="1.4"/>`;
    body += `<line x1="${(cx - capW / 2).toFixed(1)}" y1="${yLo.toFixed(1)}" x2="${(cx + capW / 2).toFixed(1)}" y2="${yLo.toFixed(1)}" stroke="${PALETTE.text}" stroke-width="1.4"/>`;

    body += `<text x="${cx.toFixed(1)}" y="${(yHi - 6).toFixed(1)}" font-size="10" fill="${PALETTE.text}" text-anchor="middle" font-family="ui-monospace, monospace">${p.p.toFixed(1)}%</text>`;

    // cok satirli x etiketi (\n ile bolunmus)
    const lines = String(p.label).split('\n');
    lines.forEach((ln, li) => {
      body += `<text x="${cx.toFixed(1)}" y="${(padTop + plotH + 14 + li * 10).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(ln)}</text>`;
    });
    body += `<text x="${cx.toFixed(1)}" y="${(padTop + plotH + 38).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">n=${p.total.toLocaleString('tr-TR')}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img">${grid}${body}${axisLabels(W, H, padLeft, padTop, plotW, plotH, opts)}</svg>`;
}

function renderBarCI(holder, points, color, opts = {}) {
  holder.innerHTML = svgBarChartCI(points, color, opts);
}

// ---------------- SVG gruplu (cift serili) bar grafigi ----------------

// Iki seriyi yan yana karsilastirir. Etiketler CAPRAZ yazilir (-45°) ve
// grafik cubuk sayisina gore genisler; kapsayici yatay kaydirilir.
function svgGroupedBarChart(labels, seriesA, seriesB, opts = {}) {
  const n = labels.length;
  const perGroup = opts.widthPerGroup || 62;
  const padLeft = 46, padRight = 12, padTop = 18, padBottom = 96;
  const plotW = Math.max(300, n * perGroup);
  const W = padLeft + padRight + plotW;
  const H = 300;
  const plotH = H - padTop - padBottom;

  if (n === 0) {
    return `<svg viewBox="0 0 420 120" style="width:100%;height:auto;display:block;">
      <text x="210" y="60" font-size="11" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">veri yok</text></svg>`;
  }

  const yMax = maxOf([...seriesA.values, ...seriesB.values], 0) * 1.15 || 1;
  let grid = '';
  const nG = 4;
  for (let g = 0; g <= nG; g++) {
    const gy = padTop + plotH - (g / nG) * plotH;
    const val = (g / nG) * yMax;
    grid += `<line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${W - padRight}" y2="${gy.toFixed(1)}" stroke="${PALETTE.grid}" stroke-width="1"/>`;
    grid += `<text x="${padLeft - 6}" y="${(gy + 3).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace">${val >= 10 ? Math.round(val) : val.toFixed(1)}${opts.pct ? '%' : ''}</text>`;
  }

  const gap = 6, inner = 3;
  const groupW = (plotW - gap * (n - 1)) / n;
  const barW = (groupW - inner) / 2;

  let bars = '', xl = '';
  for (let i = 0; i < n; i++) {
    const gx = padLeft + i * (groupW + gap);
    const va = seriesA.values[i] || 0, vb = seriesB.values[i] || 0;
    const ha = (va / yMax) * plotH, hb = (vb / yMax) * plotH;
    bars += `<rect x="${gx.toFixed(1)}" y="${(padTop + plotH - ha).toFixed(1)}" width="${barW.toFixed(1)}" height="${ha.toFixed(1)}" fill="${seriesA.color}" rx="2"/>`;
    bars += `<rect x="${(gx + barW + inner).toFixed(1)}" y="${(padTop + plotH - hb).toFixed(1)}" width="${barW.toFixed(1)}" height="${hb.toFixed(1)}" fill="${seriesB.color}" rx="2"/>`;
    const cx = gx + groupW / 2;
    const ly = padTop + plotH + 10;
    xl += `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace" transform="rotate(-45 ${cx.toFixed(1)} ${ly.toFixed(1)})">${escapeXml(String(labels[i]))}</text>`;
  }

  const ly = H - 8;
  let legend = `<rect x="${padLeft}" y="${ly - 8}" width="10" height="4" fill="${seriesA.color}" rx="2"/>`;
  legend += `<text x="${padLeft + 15}" y="${ly - 4}" font-size="9.5" fill="${PALETTE.text}" font-family="ui-monospace, monospace">${escapeXml(seriesA.label)}</text>`;
  legend += `<rect x="${padLeft + 190}" y="${ly - 8}" width="10" height="4" fill="${seriesB.color}" rx="2"/>`;
  legend += `<text x="${padLeft + 205}" y="${ly - 4}" font-size="9.5" fill="${PALETTE.text}" font-family="ui-monospace, monospace">${escapeXml(seriesB.label)}</text>`;

  const yl = opts.yLabel
    ? `<text x="12" y="${(padTop + plotH / 2).toFixed(1)}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace" transform="rotate(-90 12 ${(padTop + plotH / 2).toFixed(1)})">${escapeXml(opts.yLabel)}</text>`
    : '';

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img">${grid}${bars}${xl}${legend}${yl}</svg>`;
}

// ---------------- SVG isi haritasi (matris) ----------------

// rows: [{name, total, cells:[{day, pct, n}]}], baseline ayni bicimde tek satir
function svgHeatmap(rows, colLabels, opts = {}) {
  if (!rows || rows.length === 0) {
    return `<svg viewBox="0 0 420 100" style="width:100%;height:auto;display:block;">
      <text x="210" y="50" font-size="11" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">veri yok</text></svg>`;
  }
  const cellW = opts.cellW || 52, cellH = opts.cellH || 26;
  const padLeft = opts.padLeft || 210, padTop = 34, padRight = 60, padBottom = 14;
  const W = padLeft + colLabels.length * cellW + padRight;
  const H = padTop + rows.length * cellH + padBottom;
  const maxPct = maxOf(rows.flatMap((r) => r.cells.map((cc) => cc.pct)), 1) || 1;

  let body = '';
  colLabels.forEach((lb, j) => {
    body += `<text x="${(padLeft + j * cellW + cellW / 2).toFixed(1)}" y="${padTop - 10}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(String(lb))}</text>`;
  });

  rows.forEach((r, i) => {
    const y = padTop + i * cellH;
    const nm = r.name.length > 26 ? r.name.slice(0, 25) + '…' : r.name;
    body += `<text x="${padLeft - 8}" y="${(y + cellH / 2 + 3).toFixed(1)}" font-size="9.5" fill="${r.isBaseline ? PALETTE.brass : PALETTE.text}" text-anchor="end" font-family="ui-monospace, monospace"${r.isBaseline ? ' font-weight="700"' : ''}>${escapeXml(nm)}</text>`;
    r.cells.forEach((cc, j) => {
      const x = padLeft + j * cellW;
      // yogunluk: 0 -> saydam, maxPct -> tam renk
      const alpha = maxPct > 0 ? Math.min(1, cc.pct / maxPct) : 0;
      body += `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" fill="${opts.color || PALETTE.renew}" opacity="${(0.08 + alpha * 0.82).toFixed(3)}" rx="2"/>`;
      const txtFill = alpha > 0.55 ? '#f5efe0' : PALETTE.ink || '#211d17';
      body += `<text x="${(x + (cellW - 2) / 2).toFixed(1)}" y="${(y + cellH / 2 + 3).toFixed(1)}" font-size="9" fill="${txtFill}" text-anchor="middle" font-family="ui-monospace, monospace">${cc.pct.toFixed(0)}%</text>`;
    });
    body += `<text x="${W - padRight + 8}" y="${(y + cellH / 2 + 3).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" font-family="ui-monospace, monospace">n=${r.total.toLocaleString('tr-TR')}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img">${body}</svg>`;
}

function renderHeatmap(holder, rows, colLabels, opts = {}) {
  const svg = svgHeatmap(rows, colLabels, opts);
  const minW = (opts.padLeft || 210) + colLabels.length * (opts.cellW || 52) + 60;
  holder.innerHTML = `<div class="scroll-x"><div style="min-width:${minW}px">${svg}</div></div>`;
}

function renderGroupedBar(holder, labels, seriesA, seriesB, opts = {}) {
  const svg = svgGroupedBarChart(labels, seriesA, seriesB, opts);
  const minW = Math.max(460, labels.length * (opts.widthPerGroup || 62) + 60);
  holder.innerHTML = `<div class="scroll-x"><div style="min-width:${minW}px">${svg}</div></div>`;
}

// ---------------- SVG cok serili cizgi / basamak grafigi ----------------

// series: [{label, color, points:[{x, y, lo?, hi?}]}]
// opts: {step:bool, band:bool, yMax, yLabel, xLabel, yPct:bool}
function svgLineChart(series, opts = {}) {
  // Legend satir sayisina ve capraz etikete gore alt bosluk BUYUR, ve toplam
  // yuksekligi de ayni oranda artir - aksi halde cizim alani kucululup
  // legend viewBox disina tasardi.
  const legendRows = Math.ceil(series.length / 2);
  const extraBottom = Math.max(0, legendRows - 2) * 13 + (opts.rotateXTicks ? 40 : 0);
  const W = 460, H = 290 + extraBottom;
  const padLeft = 42 + (opts.yLabel ? 16 : 0), padRight = 12, padTop = 14;
  const padBottom = 58 + extraBottom;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">
      <text x="${W / 2}" y="${H / 2}" font-size="11" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">veri yok</text></svg>`;
  }

  const xMin = minOf(all.map((p) => p.x));
  const xMax = maxOf(all.map((p) => p.x));
  const xRange = (xMax - xMin) || 1;
  const yMaxData = maxOf(all.map((p) => (p.hi !== undefined ? p.hi : p.y)));
  const yMax = opts.yMax !== undefined ? opts.yMax : (yMaxData > 0 ? yMaxData * 1.1 : 1);

  const X = (x) => padLeft + ((x - xMin) / xRange) * plotW;
  const Y = (y) => padTop + plotH - (Math.min(y, yMax) / yMax) * plotH;

  let grid = '';
  const nGrid = 4;
  for (let g = 0; g <= nGrid; g++) {
    const gy = padTop + plotH - (g / nGrid) * plotH;
    const val = (g / nGrid) * yMax;
    const lbl = opts.yPct ? `${Math.round(val * 100)}%` : (val >= 10 ? Math.round(val) : val.toFixed(1));
    grid += `<line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${W - padRight}" y2="${gy.toFixed(1)}" stroke="${PALETTE.grid}" stroke-width="1"/>`;
    grid += `<text x="${padLeft - 6}" y="${(gy + 3).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace">${lbl}</text>`;
  }

  // x ekseni etiketleri (tam sayi gunler)
  let xLabels = '';
  const tickCount = Math.min(Math.round(xRange) + 1, opts.maxXTicks || 10);
  const fmtX = opts.xFormat || ((v) => Math.round(v));
  for (let i = 0; i < tickCount; i++) {
    const xv = xMin + (i / Math.max(tickCount - 1, 1)) * xRange;
    const px = X(xv), py = padTop + plotH + 14;
    xLabels += opts.rotateXTicks
      ? `<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="end" font-family="ui-monospace, monospace" transform="rotate(-45 ${px.toFixed(1)} ${py.toFixed(1)})">${escapeXml(String(fmtX(xv)))}</text>`
      : `<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(String(fmtX(xv)))}</text>`;
  }

  let body = '';
  series.forEach((s) => {
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    if (pts.length === 0) return;

    // guven bandi
    if (opts.band && pts.every((p) => p.lo !== undefined)) {
      let up = '', dn = '';
      pts.forEach((p, i) => {
        const px = X(p.x), pyH = Y(p.hi), pyL = Y(p.lo);
        if (opts.step && i > 0) {
          const prevH = Y(pts[i - 1].hi);
          up += ` L ${px.toFixed(1)} ${prevH.toFixed(1)}`;
        }
        up += `${i === 0 ? 'M' : ' L'} ${px.toFixed(1)} ${pyH.toFixed(1)}`;
      });
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        const px = X(p.x), pyL = Y(p.lo);
        if (opts.step && i < pts.length - 1) {
          const nextL = Y(pts[i + 1].lo);
          dn += ` L ${px.toFixed(1)} ${nextL.toFixed(1)}`;
        }
        dn += ` L ${px.toFixed(1)} ${pyL.toFixed(1)}`;
      }
      body += `<path d="${up}${dn} Z" fill="${s.color}" opacity="0.13"/>`;
    }

    // ana cizgi (basamak veya duz)
    let d = '';
    pts.forEach((p, i) => {
      const px = X(p.x), py = Y(p.y);
      if (i === 0) { d += `M ${px.toFixed(1)} ${py.toFixed(1)}`; return; }
      if (opts.step) {
        const prevY = Y(pts[i - 1].y);
        d += ` L ${px.toFixed(1)} ${prevY.toFixed(1)}`;
      }
      d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
    });
    body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${opts.lineWidth || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;

    if (opts.dots) {
      pts.forEach((p) => { body += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${s.color}"/>`; });
    }
  });

  // legend
  let legend = '';
  const perRow = 2;
  series.forEach((s, i) => {
    const col = i % perRow, row = Math.floor(i / perRow);
    const lx = padLeft + col * (plotW / perRow);
    const ly = padTop + plotH + 30 + (opts.rotateXTicks ? 40 : 0) + row * 13;
    legend += `<rect x="${lx}" y="${ly - 6}" width="9" height="3" fill="${s.color}" rx="1.5"/>`;
    legend += `<text x="${lx + 13}" y="${ly}" font-size="9" fill="${PALETTE.text}" font-family="ui-monospace, monospace">${escapeXml(s.label)}</text>`;
  });

  let axisLbl = opts.xLabel
    ? `<text x="${(padLeft + plotW / 2).toFixed(1)}" y="${(padTop + plotH + 26).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(opts.xLabel)}</text>`
    : '';
  if (opts.yLabel) {
    const cy = padTop + plotH / 2;
    axisLbl += `<text x="12" y="${cy.toFixed(1)}" font-size="9.5" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace" transform="rotate(-90 12 ${cy.toFixed(1)})">${escapeXml(opts.yLabel)}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img">${grid}${body}${xLabels}${axisLbl}${legend}</svg>`;
}

function renderLine(holder, series, opts = {}) {
  const svg = svgLineChart(series, opts);
  if (opts.minWidthPx) {
    holder.innerHTML = `<div class="scroll-x"><div style="min-width:${opts.minWidthPx}px">${svg}</div></div>`;
  } else {
    holder.innerHTML = svg;
  }
}

// ---------------- SVG forest plot (odds oranlari, log olcek) ----------------

// rows: [{label, or, orLo, orHi, p}]
function svgForestPlot(rows) {
  const rowH = 30;
  const W = 460;
  const padLeft = 150, padRight = 54, padTop = 24;
  const H = padTop + rows.length * rowH + 28;
  const plotW = W - padLeft - padRight;

  if (rows.length === 0) {
    return `<svg viewBox="0 0 ${W} 80" style="width:100%;height:auto;display:block;">
      <text x="${W / 2}" y="40" font-size="11" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">model kurulamadı</text></svg>`;
  }

  // log olcek sinirlari
  const finite = rows.flatMap((r) => [r.orLo, r.or, r.orHi]).filter((v) => Number.isFinite(v) && v > 0);
  let lo = minOf(finite, 0.5), hi = maxOf(finite, 2);
  lo = Math.max(lo * 0.8, 0.02); hi = Math.min(hi * 1.2, 50);
  const lLo = Math.log(lo), lHi = Math.log(hi);
  const X = (v) => padLeft + ((Math.log(Math.max(v, lo)) - lLo) / (lHi - lLo)) * plotW;

  let body = '';
  // referans cizgisi OR=1
  const x1 = X(1);
  body += `<line x1="${x1.toFixed(1)}" y1="${padTop - 8}" x2="${x1.toFixed(1)}" y2="${(padTop + rows.length * rowH).toFixed(1)}" stroke="${PALETTE.textDim}" stroke-width="1" stroke-dasharray="3 3"/>`;
  body += `<text x="${x1.toFixed(1)}" y="${padTop - 12}" font-size="9" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">OR=1</text>`;

  rows.forEach((r, i) => {
    const y = padTop + i * rowH + rowH / 2;
    const sig = Number.isFinite(r.p) && r.p < 0.05;
    const color = r.or >= 1 ? PALETTE.cancel : PALETTE.renew;
    const opacity = sig ? 1 : 0.42;

    body += `<text x="${padLeft - 10}" y="${(y + 3).toFixed(1)}" font-size="9.5" fill="${PALETTE.text}" text-anchor="end" font-family="ui-monospace, monospace">${escapeXml(r.label)}</text>`;

    if (Number.isFinite(r.orLo) && Number.isFinite(r.orHi)) {
      body += `<line x1="${X(r.orLo).toFixed(1)}" y1="${y.toFixed(1)}" x2="${X(r.orHi).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1.6" opacity="${opacity}"/>`;
      body += `<line x1="${X(r.orLo).toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${X(r.orLo).toFixed(1)}" y2="${(y + 4).toFixed(1)}" stroke="${color}" stroke-width="1.6" opacity="${opacity}"/>`;
      body += `<line x1="${X(r.orHi).toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${X(r.orHi).toFixed(1)}" y2="${(y + 4).toFixed(1)}" stroke="${color}" stroke-width="1.6" opacity="${opacity}"/>`;
    }
    body += `<circle cx="${X(r.or).toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${color}" opacity="${opacity}"/>`;
    body += `<text x="${W - padRight + 8}" y="${(y + 3).toFixed(1)}" font-size="9" fill="${PALETTE.text}" font-family="ui-monospace, monospace">${r.or.toFixed(2)}</text>`;
  });

  // x ekseni etiketleri
  const ticks = [0.25, 0.5, 1, 2, 4, 8].filter((t) => t >= lo && t <= hi);
  let xl = '';
  ticks.forEach((t) => {
    xl += `<text x="${X(t).toFixed(1)}" y="${(padTop + rows.length * rowH + 14).toFixed(1)}" font-size="9" fill="${PALETTE.textDim}" text-anchor="middle" font-family="ui-monospace, monospace">${t}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img">${body}${xl}</svg>`;
}

function renderForest(holder, rows) {
  holder.innerHTML = svgForestPlot(rows);
}

function makeTableCard(container, title, sub, headers, rows, opts = {}) {
  const card = document.createElement('div');
  card.className = 'chart-card';
  const head = headers.map((h) => `<th class="${h.num ? 'num' : ''}">${escapeXml(h.label)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((cell) => {
    const v = typeof cell === 'object' ? cell : { v: cell };
    return `<td class="${v.num ? 'num' : ''} ${v.cls || ''}">${v.raw ? v.v : escapeXml(String(v.v))}</td>`;
  }).join('')}</tr>`).join('');
  card.innerHTML = `<h3>${escapeXml(title)}</h3><div class="chart-sub">${escapeXml(sub)}</div>` +
    (opts.searchable ? `<input type="text" class="table-search" placeholder="${escapeAttr(opts.searchPlaceholder || 'Ara…')}">` : '') +
    `<div class="table-scroll"><table class="coef-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` +
    (opts.searchable ? '<div class="search-count"></div>' : '');
  container.appendChild(card);

  if (opts.searchable) {
    const inp = card.querySelector('.table-search');
    const tbody = card.querySelector('tbody');
    const cnt = card.querySelector('.search-count');
    const allRows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    const apply = () => {
      const q = inp.value.trim().toLowerCase();
      let shown = 0;
      allRows.forEach((tr) => {
        const hit = q === '' || tr.textContent.toLowerCase().includes(q);
        tr.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      cnt.textContent = q === '' ? `${allRows.length} satır` : `${shown} / ${allRows.length} satır eşleşti`;
    };
    inp.addEventListener('input', apply);
    apply();
  }

  return card;
}

