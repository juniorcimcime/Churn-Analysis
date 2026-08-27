/* ============================================================
   Istatistik modulu - sifir dis bagimlilik.
   Kaplan-Meier, log-rank testi, lojistik regresyon (IRLS),
   ayrik zamanli hazard. Hepsi elle yazildi.
   ============================================================ */

// Buyuk dizilerde Math.min(...arr) YIGIN TASMASINA yol acar (her eleman ayri
// argüman olarak yigina binder; ~100K'da coker). Dongu tabanli guvenli hali.
function minOf(arr, init) {
  let m = init === undefined ? Infinity : init;
  for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i];
  return m;
}
function maxOf(arr, init) {
  let m = init === undefined ? -Infinity : init;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

// ---------------- Kaplan-Meier ----------------

// obs: [{time, event}] - event=1 olay gerceklesti, 0 sansurlu (right-censored)
// Donus: {points:[{t, s, lo, hi, atRisk, events}], median}
// Guven araligi Greenwood varyansi + log-log donusumu ile (0-1 disina tasmaz).
function kaplanMeier(obs, z = 1.96) {
  const clean = obs.filter((o) => Number.isFinite(o.time) && o.time >= 0);
  if (clean.length === 0) return { points: [], median: null, n: 0 };

  const sorted = [...clean].sort((a, b) => a.time - b.time);
  const n = sorted.length;

  // benzersiz zamanlarda olay/sansur sayilari
  const times = [];
  let i = 0;
  while (i < sorted.length) {
    const t = sorted[i].time;
    let d = 0, c = 0;
    while (i < sorted.length && sorted[i].time === t) {
      if (sorted[i].event === 1) d++; else c++;
      i++;
    }
    times.push({ t, d, c });
  }

  const points = [{ t: 0, s: 1, lo: 1, hi: 1, atRisk: n, events: 0 }];
  let s = 1;
  let atRisk = n;
  let cumVar = 0; // Greenwood: Σ d/(n(n-d))

  for (const { t, d, c } of times) {
    if (atRisk <= 0) break;
    if (d > 0) {
      s *= (1 - d / atRisk);
      cumVar += d / (atRisk * (atRisk - d) || 1);
    }
    let lo = s, hi = s;
    if (s > 0 && s < 1 && cumVar > 0) {
      // log-log donusumu: CI = s^exp(±z·se/ln s)
      const se = Math.sqrt(cumVar) / Math.abs(Math.log(s));
      lo = Math.pow(s, Math.exp(z * se));
      hi = Math.pow(s, Math.exp(-z * se));
    }
    points.push({ t, s, lo: Math.max(0, lo), hi: Math.min(1, hi), atRisk, events: d });
    atRisk -= (d + c);
  }

  // medyan sagkalim: S(t) ilk kez <= 0.5 olan t
  let median = null;
  for (const p of points) {
    if (p.s <= 0.5) { median = p.t; break; }
  }

  return { points, median, n };
}

// ---------------- Log-rank testi ----------------

// groups: [{label, obs:[{time,event}]}]  (2 veya daha fazla grup)
// Donus: {chi2, df, p, perGroup:[{label, observed, expected}]}
function logRankTest(groups) {
  const valid = groups.filter((g) => g.obs.length > 0);
  const k = valid.length;
  if (k < 2) return { chi2: 0, df: 0, p: 1, perGroup: [] };

  // tum benzersiz olay zamanlari
  const allTimes = new Set();
  valid.forEach((g) => g.obs.forEach((o) => { if (o.event === 1) allTimes.add(o.time); }));
  const eventTimes = [...allTimes].sort((a, b) => a - b);

  const O = new Array(k).fill(0);
  const E = new Array(k).fill(0);
  // V: kovaryans matrisi (k-1 boyutlu kullanacagiz)
  const V = Array.from({ length: k }, () => new Array(k).fill(0));

  const atRiskAt = (obs, t) => obs.reduce((acc, o) => acc + (o.time >= t ? 1 : 0), 0);
  const eventsAt = (obs, t) => obs.reduce((acc, o) => acc + (o.time === t && o.event === 1 ? 1 : 0), 0);

  for (const t of eventTimes) {
    const nj = valid.map((g) => atRiskAt(g.obs, t));
    const dj = valid.map((g) => eventsAt(g.obs, t));
    const nTot = nj.reduce((a, b) => a + b, 0);
    const dTot = dj.reduce((a, b) => a + b, 0);
    if (nTot <= 1 || dTot === 0) continue;

    for (let a = 0; a < k; a++) {
      O[a] += dj[a];
      E[a] += (dTot * nj[a]) / nTot;
    }
    // hipergeometrik varyans
    const factor = (dTot * (nTot - dTot)) / (nTot * nTot * (nTot - 1));
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) {
        const delta = a === b ? 1 : 0;
        V[a][b] += factor * nj[a] * (nTot * delta - nj[b]);
      }
    }
  }

  // (k-1) boyutlu forma indirge (son grup referans)
  const m = k - 1;
  const diff = [];
  const Vred = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let a = 0; a < m; a++) {
    diff.push(O[a] - E[a]);
    for (let b = 0; b < m; b++) Vred[a][b] = V[a][b];
  }

  let chi2 = 0;
  const Vinv = invertMatrix(Vred);
  if (Vinv) {
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) chi2 += diff[a] * Vinv[a][b] * diff[b];
    }
  }
  if (!Number.isFinite(chi2) || chi2 < 0) chi2 = 0;

  return {
    chi2,
    df: m,
    p: chiSquarePValue(chi2, m),
    perGroup: valid.map((g, idx) => ({ label: g.label, observed: O[idx], expected: E[idx] })),
  };
}

// ---------------- Ayrik zamanli hazard ----------------

// Gun d icin: h(d) = o gun olay sayisi / o gunun basinda risk altindaki sayi
function discreteHazard(obs, maxDay) {
  const rows = [];
  let atRisk = obs.length;
  for (let d = 1; d <= maxDay; d++) {
    if (atRisk <= 0) { rows.push({ day: d, hazard: 0, atRisk: 0, events: 0 }); continue; }
    const events = obs.reduce((a, o) => a + (o.time === d && o.event === 1 ? 1 : 0), 0);
    const censored = obs.reduce((a, o) => a + (o.time === d && o.event !== 1 ? 1 : 0), 0);
    rows.push({ day: d, hazard: (events / atRisk) * 100, atRisk, events });
    atRisk -= (events + censored);
  }
  return rows;
}

// ---------------- Matris yardimcilari ----------------

function invertMatrix(A) {
  const n = A.length;
  if (n === 0) return null;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null; // tekil matris
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

// ---------------- Lojistik regresyon (IRLS) ----------------

// X: [[x1,x2,...], ...] (kesisim OTOMATIK eklenir), y: [0/1]
// names: katsayi adlari (kesisim haric)
// Sayisal kararlilik icin surekli degiskenler standartlastirilir; katsayilar
// "1 SD basina" olarak raporlanir (ikili degiskenler oldugu gibi kalir).
function logisticRegression(X, y, names, opts = {}) {
  const maxIter = opts.maxIter || 50;
  const tol = opts.tol || 1e-8;
  const ridge = opts.ridge !== undefined ? opts.ridge : 1e-6;

  const n = X.length;
  if (n === 0 || y.length !== n) return null;
  const pRaw = X[0].length;

  // sabit (varyansi sifir) kolonlari at
  const keep = [];
  for (let j = 0; j < pRaw; j++) {
    const col = X.map((r) => r[j]);
    const mn = minOf(col), mx = maxOf(col);
    if (mx - mn > 1e-12) keep.push(j);
  }
  if (keep.length === 0) return null;

  // standartlastirma (ikili 0/1 kolonlar oldugu gibi birakilir)
  const means = [], sds = [], isBinary = [];
  keep.forEach((j) => {
    const col = X.map((r) => r[j]);
    const uniq = new Set(col);
    const bin = uniq.size <= 2 && [...uniq].every((v) => v === 0 || v === 1);
    isBinary.push(bin);
    if (bin) { means.push(0); sds.push(1); }
    else {
      const mu = col.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(col.reduce((a, b) => a + (b - mu) ** 2, 0) / n) || 1;
      means.push(mu); sds.push(sd);
    }
  });

  const p = keep.length + 1; // + kesisim
  const Z = X.map((row) => {
    const r = [1];
    keep.forEach((j, idx) => r.push((row[j] - means[idx]) / sds[idx]));
    return r;
  });

  let beta = new Array(p).fill(0);
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    const mu = Z.map((row) => {
      const eta = row.reduce((a, v, j) => a + v * beta[j], 0);
      const clipped = Math.max(-30, Math.min(30, eta));
      return 1 / (1 + Math.exp(-clipped));
    });
    const W = mu.map((m) => Math.max(m * (1 - m), 1e-8));

    // X'WX + ridge·I  ve  X'W z   (z = eta + (y-mu)/W)
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0));
    const XtWz = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const eta = Z[i].reduce((a, v, j) => a + v * beta[j], 0);
      const zi = eta + (y[i] - mu[i]) / W[i];
      for (let a = 0; a < p; a++) {
        XtWz[a] += Z[i][a] * W[i] * zi;
        for (let b = 0; b < p; b++) XtWX[a][b] += Z[i][a] * W[i] * Z[i][b];
      }
    }
    for (let a = 0; a < p; a++) XtWX[a][a] += ridge;

    const inv = invertMatrix(XtWX);
    if (!inv) return null;

    const newBeta = new Array(p).fill(0);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) newBeta[a] += inv[a][b] * XtWz[b];

    const delta = newBeta.reduce((acc, v, j) => acc + Math.abs(v - beta[j]), 0);
    beta = newBeta;
    if (delta < tol) { converged = true; break; }
  }

  // son Hessian'dan standart hatalar
  const muF = Z.map((row) => {
    const eta = row.reduce((a, v, j) => a + v * beta[j], 0);
    const clipped = Math.max(-30, Math.min(30, eta));
    return 1 / (1 + Math.exp(-clipped));
  });
  const WF = muF.map((m) => Math.max(m * (1 - m), 1e-8));
  const H = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) H[a][b] += Z[i][a] * WF[i] * Z[i][b];
  }
  // Standart hatalar icin Hessian'i tersle. Degiskenler ESDOGRUSAL ise
  // (or. iki ozellik hep birlikte hareket ediyorsa) matris TEKIL olur ve
  // ters alinamaz. Bu durumda SE sessizce NaN donerse ekranda "anlamsiz"
  // gibi gorunur - yaniltici. O yuzden ridge'i kademeli artirarak tekrar
  // deniyor ve basarisiz olursa acikca isaretliyoruz.
  let Hinv = null, usedRidge = ridge, seWarning = false;
  for (const mult of [1, 1e2, 1e4, 1e6]) {
    const Htry = H.map((row) => [...row]);
    const extra = ridge * mult - ridge;
    for (let a = 0; a < p; a++) Htry[a][a] += extra;
    Hinv = invertMatrix(Htry);
    if (Hinv) { usedRidge = ridge * mult; seWarning = mult > 1; break; }
  }
  const se = Hinv ? Hinv.map((r, a) => Math.sqrt(Math.max(r[a], 0))) : new Array(p).fill(NaN);
  const seReliable = Hinv !== null && !seWarning;

  const terms = [];
  keep.forEach((j, idx) => {
    const a = idx + 1;
    const b = beta[a];
    const s = se[a];
    const zStat = s > 0 ? b / s : 0;
    terms.push({
      name: names[j],
      beta: b,
      se: s,
      z: zStat,
      p: normalTwoSidedP(zStat),
      or: Math.exp(b),
      orLo: Math.exp(b - 1.96 * s),
      orHi: Math.exp(b + 1.96 * s),
      standardized: !isBinary[idx],
    });
  });

  // log-olabilirlik ve McFadden pseudo-R²
  const ll = y.reduce((acc, yi, i) => acc + (yi * Math.log(Math.max(muF[i], 1e-12)) + (1 - yi) * Math.log(Math.max(1 - muF[i], 1e-12))), 0);
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  const ll0 = y.reduce((acc, yi) => acc + (yi * Math.log(Math.max(ybar, 1e-12)) + (1 - yi) * Math.log(Math.max(1 - ybar, 1e-12))), 0);
  const pseudoR2 = ll0 !== 0 ? 1 - ll / ll0 : 0;

  // Yeni gozlemleri skorlayabilmek icin donusum bilgisini de disari veriyoruz
  // (hangi kolonlar tutuldu, hangi ortalama/SD ile standartlastirildi).
  return {
    intercept: beta[0], terms, n, converged, pseudoR2, logLik: ll,
    transform: { keep, means, sds }, beta,
    seReliable, usedRidge,
  };
}

// Egitilmis modelle yeni bir gozlemi skorlar (0-1 olasilik).
// Egitimdeki ayni kolon secimi ve standartlastirmayi uygular.
function scoreLogistic(fit, rawRow) {
  if (!fit || !fit.transform) return 0;
  const { keep, means, sds } = fit.transform;
  let eta = fit.beta[0];
  keep.forEach((j, idx) => {
    const z = (rawRow[j] - means[idx]) / (sds[idx] || 1);
    eta += fit.beta[idx + 1] * z;
  });
  const clipped = Math.max(-30, Math.min(30, eta));
  return 1 / (1 + Math.exp(-clipped));
}

// ---------------- Karar agaci (CART, gini) ----------------

// Sig bir agac KASITLI: cikti, insanin okuyup urune koyabilecegi bir KURAL
// olmali. Derin agac veriye daha iyi uyar ama uygulanamaz ve asiri ogrenir.
function buildDecisionTree(X, y, opts = {}) {
  const maxDepth = opts.maxDepth || 3;
  const minLeaf = opts.minLeaf || 50;
  const maxThresholds = opts.maxThresholds || 16;
  const names = opts.featureNames || [];
  const n = X.length;
  if (n === 0) return null;
  const p = X[0].length;
  const cols = [];
  for (let f = 0; f < p; f++) cols.push(X.map((r) => r[f]));

  const gini = (pos, tot) => {
    if (tot === 0) return 0;
    const a = pos / tot;
    return 2 * a * (1 - a);
  };

  const candidateThresholds = (idx, col) => {
    const uniq = [...new Set(idx.map((i) => col[i]))].sort((a, b) => a - b);
    if (uniq.length <= 1) return [];
    if (uniq.length <= maxThresholds) {
      const out = [];
      for (let k = 0; k < uniq.length - 1; k++) out.push((uniq[k] + uniq[k + 1]) / 2);
      return out;
    }
    const out = [];
    for (let k = 1; k < maxThresholds; k++) {
      const q = uniq[Math.floor((k / maxThresholds) * uniq.length)];
      if (out.length === 0 || out[out.length - 1] !== q) out.push(q);
    }
    return out;
  };

  function grow(idx, depth) {
    const tot = idx.length;
    const pos = idx.reduce((a, i) => a + y[i], 0);
    const node = { n: tot, pos, rate: tot ? (pos / tot) * 100 : 0, leaf: true };
    if (depth >= maxDepth || tot < 2 * minLeaf || pos === 0 || pos === tot) return node;

    const parentImp = gini(pos, tot);
    let best = null;
    for (let f = 0; f < p; f++) {
      const col = cols[f];
      for (const thr of candidateThresholds(idx, col)) {
        let lN = 0, lP = 0, rN = 0, rP = 0;
        for (const i of idx) {
          if (col[i] <= thr) { lN++; lP += y[i]; } else { rN++; rP += y[i]; }
        }
        if (lN < minLeaf || rN < minLeaf) continue;
        const weighted = (lN / tot) * gini(lP, lN) + (rN / tot) * gini(rP, rN);
        const gain = parentImp - weighted;
        if (!best || gain > best.gain) best = { gain, f, thr };
      }
    }
    if (!best || best.gain <= 1e-9) return node;

    const colBest = cols[best.f];
    node.leaf = false;
    node.feature = best.f;
    node.featureName = names[best.f] || `x${best.f}`;
    node.threshold = best.thr;
    node.gain = best.gain;
    node.left = grow(idx.filter((i) => colBest[i] <= best.thr), depth + 1);
    node.right = grow(idx.filter((i) => colBest[i] > best.thr), depth + 1);
    return node;
  }

  return grow([...Array(n).keys()], 0);
}

// Agaci "kural listesi"ne cevirir - her yaprak uygulanabilir bir kural.
function treeToRules(node, path = []) {
  if (!node) return [];
  if (node.leaf) return [{ conditions: path, n: node.n, pos: node.pos, rate: node.rate }];
  const fmt = (v) => (Number.isInteger(v) ? v : v.toFixed(2));
  return [
    ...treeToRules(node.left, [...path, `${node.featureName} ≤ ${fmt(node.threshold)}`]),
    ...treeToRules(node.right, [...path, `${node.featureName} > ${fmt(node.threshold)}`]),
  ];
}

// ---------------- Precision-Recall egrisi ----------------

// Skora gore azalan sirada esik gezdirir. Her nokta: kac ziyaret tetiklenirdi,
// kaci gercekten iptalle sonuclandi, precision ve recall.
function prCurve(scores, y, maxPoints = 60) {
  const n = scores.length;
  if (n === 0) return [];
  const order = [...Array(n).keys()].sort((a, b) => scores[b] - scores[a]);
  const totalPos = y.reduce((a, b) => a + b, 0);
  if (totalPos === 0) return [];
  const step = Math.max(1, Math.floor(n / maxPoints));
  const out = [];
  let tp = 0;
  for (let k = 0; k < n; k++) {
    tp += y[order[k]];
    const triggered = k + 1;
    if (triggered % step === 0 || k === n - 1) {
      out.push({
        threshold: scores[order[k]], triggered, tp, fp: triggered - tp,
        precision: (tp / triggered) * 100, recall: (tp / totalPos) * 100,
      });
    }
  }
  return out;
}

// ---------------- McNemar testi (eslestirilmis ikili veri) ----------------

// Ayni kullanicinin iki penceresi karsilastirildigi icin gozlemler BAGIMSIZ
// degil - siradan ki-kare burada yanlistir. McNemar sadece UYUMSUZ ciftlere
// bakar: b = vakada var/kontrolde yok, c = vakada yok/kontrolde var.
// Sureklilik duzeltmeli (Edwards) form kullaniliyor; b+c kucukse muhafazakar.
function mcNemarTest(b, c) {
  const n = b + c;
  if (n === 0) return { chi2: 0, p: 1, or: null };
  const chi2 = Math.pow(Math.abs(b - c) - 1, 2) / n;
  const or = c === 0 ? (b === 0 ? null : Infinity) : b / c;
  return { chi2, p: chiSquarePValue(chi2, 1), or };
}

// Standart normal ust kuyruk (Abramowitz-Stegun 7.1.26 tabanli erf yaklasimi)
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, pp = 0.3275911;
  const t = 1 / (1 + pp * x);
  const yv = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * yv;
}

function normalTwoSidedP(z) {
  const a = Math.abs(z);
  return 2 * (1 - 0.5 * (1 + erf(a / Math.SQRT2)));
}

// Ki-kare ust kuyruk olasiligi (regularize edilmis tamamlanmamis gamma)
function chiSquarePValue(x, df) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  if (df <= 0) return 1;
  return gammaincUpper(df / 2, x / 2);
}

function logGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let xx = x, y = x, tmp = xx + 5.5;
  tmp -= (xx + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / xx);
}

// Q(a,x) = 1 - P(a,x); seri ve surekli kesir birlesimi (Numerical Recipes)
function gammaincUpper(a, x) {
  if (x < 0 || a <= 0) return 1;
  if (x === 0) return 1;
  if (x < a + 1) {
    // seri acilimi -> P(a,x)
    let ap = a, sum = 1 / a, del = sum;
    for (let i = 0; i < 500; i++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    const P = sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    return Math.min(1, Math.max(0, 1 - P));
  }
  // surekli kesir -> Q(a,x)
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  const Q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return Math.min(1, Math.max(0, Q));
}




// SABIT genislikte binler (0'dan baslar), "0-30, 30-60, ..." seklinde araliklar.
// Bin genisligi veriye gore degil, SABIT binWidth'e gore belirlenir - bu
// yuzden farkli filtrelerde/gruplarda binler karsilastirilabilir.
function fixedWidthBins(values, binWidth) {
  if (!values || values.length === 0) return { labels: [], values: [] };
  const maxVal = maxOf(values, 0);
  const nBins = Math.max(1, Math.ceil((maxVal + 1e-9) / binWidth));
  const counts = new Array(nBins).fill(0);
  values.forEach((v) => {
    let idx = Math.floor(v / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    counts[idx]++;
  });
  const labels = counts.map((_, i) => `${i * binWidth}-${(i + 1) * binWidth}`);
  return { labels, values: counts };
}

// Cok fazla bin/nokta oldugunda x ekseni etiketlerini seyreltmek icin adim
// sayisi hesaplar (ilk ve son etiket her zaman gosterilir).
function autoStride(n, maxLabels = 12) {
  return n > maxLabels ? Math.ceil(n / maxLabels) : 1;
}

function wilsonCI(successes, total, z = 1.96) {
  if (total === 0) return { p: 0, lo: 0, hi: 0 };
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { p: p * 100, lo: Math.max(0, (center - margin) * 100), hi: Math.min(100, (center + margin) * 100) };
}

// Maruziyet grubu siniflandirmasi:
//   A  = ilk generation denemesi BASARILI
//   B1 = ilk deneme FAIL, ama pencerede en az bir basarili generation var
//   B2 = ilk deneme FAIL, hic basarili generation yok
//   C  = pencerede hic generation denemesi yok
// C'yi ayri tutmak kritik: aksi halde hic denemeyenler "basarili" grubuna
// karisir ve A grubunun cancel orani yapay olarak sisip B'nin etkisini gizler.
function percentile(sortedArr, p) {
  if (!sortedArr || sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function niceBinWidth(maxVal, targetBins) {
  if (!Number.isFinite(maxVal) || maxVal <= 0) return 1;
  const raw = maxVal / targetBins;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (mag * m >= raw) return mag * m;
  }
  return mag * 10;
}

function fmtP(p) {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p.toFixed(3)}`;
}


