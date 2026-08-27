// ---------------- config ----------------

function readConfig() {
  const splitCsv = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    userIdCols: splitCsv(document.getElementById('cfgUserIdCols').value),
    timeCols: splitCsv(document.getElementById('cfgTimeCols').value),
    proSuccessEvent: document.getElementById('cfgProSuccess').value.trim(),
    renewalEvent: document.getElementById('cfgRenewal').value.trim(),
    cancelEvent: document.getElementById('cfgCancel').value.trim(),
    imageGenEvent: document.getElementById('cfgImageGen').value.trim(),
    imageGenFailedEvent: document.getElementById('cfgImageGenFailed').value.trim(),
    aiTypeCols: (document.getElementById('cfgAiTypeCols').value || '').split(',').map((s) => s.trim()).filter(Boolean),
    customAiTypes: (document.getElementById('cfgCustomAi').value || '').split(',').map((s) => s.trim()).filter(Boolean),
    coinsCol: document.getElementById('cfgCoinsCol').value.trim(),
    productIdCols: splitCsv(document.getElementById('cfgProductIdCols').value),
    weeklyKeyword: document.getElementById('cfgWeeklyKeyword').value.trim().toLowerCase(),
    trialKeywords: (document.getElementById('cfgTrialKeyword').value || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    impliedSubEvents: splitCsv(document.getElementById('cfgImpliedSubEvents').value),
    onlyWeeklyPlans: document.getElementById('cfgOnlyWeekly').checked,
    windowDays: Number(document.getElementById('cfgWindowDays').value),
    day8Seconds: Number(document.getElementById('cfgDay8Hours').value) * 3600,
    countryCols: splitCsv(document.getElementById('cfgCountryCols').value),
    osCol: document.getElementById('cfgOsCol').value.trim(),
    modelCols: splitCsv(document.getElementById('cfgModelCols').value),
  };
}

// ---------------- row helpers ----------------

function getFirstNonEmpty(row, cols) {
  for (const c of cols) {
    const v = row[c];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function getUserId(row, cfg) { return getFirstNonEmpty(row, cfg.userIdCols); }

function getEventTime(row, cfg) {
  const v = getFirstNonEmpty(row, cfg.timeCols);
  if (v === null) return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  return Math.trunc(n);
}

function getCurrentCoins(row, cfg) {
  const v = row[cfg.coinsCol];
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;

  // VERI TEMIZLEME: current_coins icin -1, bir "bos/varsayilan" degeri
  // gibi gorunuyor (cok sayida satirda goruluyor) -> 0 olarak kabul ediyoruz.
  // Bunun disindaki TUM negatif degerler (-2, -50, vs.) gercek bir veri
  // hatasi/anomalisi oldugu icin -> null yapip hesaplamalara HIC dahil etmiyoruz
  // (min/max coin, harcanan coin gibi metrikleri bozmasinlar diye).
  if (n === -1) return 0;
  if (n < 0) return null;
  return n;
}

function isWeeklyPlanRow(row, cfg) {
  if (!cfg.onlyWeeklyPlans) return true;
  for (const col of cfg.productIdCols) {
    const v = row[col];
    if (v && String(v).toLowerCase().includes(cfg.weeklyKeyword)) return true;
  }
  return false;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const SECONDS_PER_DAY = 86400;

// UTC TAKVIM GUNU mantigi: 24 saatlik kayan pencere DEGIL, gercek takvim
// tarihi farkina bakar. Ornek: T0 = 22:00, bir sonraki gun 03:00'teki event
// sadece 5 saat sonra olsa da, farkli bir takvim gunune denk geldigi icin
// "gun 2" sayilir.
function dayNumberUTC(t, t0) {
  const dayT = Math.floor(t / SECONDS_PER_DAY);
  const dayT0 = Math.floor(t0 / SECONDS_PER_DAY);
  return dayT - dayT0 + 1; // T0'in takvim gunu = gun 1
}

// windowDays takvim gunu sonra baslayan UTC gece yarisi (yani "ilk N gun"
// penceresinin bitis ani - N+1'inci takvim gununun basi).
function weekBoundaryEnd(t0, windowDays) {
  const dayT0 = Math.floor(t0 / SECONDS_PER_DAY);
  return (dayT0 + windowDays) * SECONDS_PER_DAY;
}

function bumpCounter(mapOfMaps, uid, value) {
  if (!mapOfMaps.has(uid)) mapOfMaps.set(uid, new Map());
  const m = mapOfMaps.get(uid);
  m.set(value, (m.get(value) || 0) + 1);
}

function resolveMode(counterMap) {
  // counterMap: Map<value, count> -> en sik gorulen degeri dondurur (Map
  // insertion-order koruduğu icin esitlikte ilk gorulen kazanir)
  if (!counterMap || counterMap.size === 0) return UNKNOWN_LABEL;
  let best = null;
  let bestCount = -1;
  for (const [val, count] of counterMap.entries()) {
    if (count > bestCount) { best = val; bestCount = count; }
  }
  return best;
}

// ---------------- PASS 1 (tarama: T0/renewal/cancel + demografik keşif) ----------------

async function pass1(file, cfg) {
  logLine('PASS 1: T0, ilk renewal/cancel zamanı ve ülke/OS/model dağılımı toplanıyor...');
  const firstProSuccessTime = new Map();
  const firstRenewalTime = new Map();
  const firstCancelTime = new Map();

  const countryCounts = new Map(); // uid -> Map<value,count>
  const osCounts = new Map();
  const modelCounts = new Map();
  const eventNameCounts = new Map(); // event adi -> toplam satir sayisi (sema kesfi)
  // pro_success yapan TUM userlar - weekly filtresi UYGULANMADAN. Abone
  // olmayanlari dogru tespit etmek icin sart: yillik plan alan biri weekly
  // filtresine takilirsa yanlislikla "abone degil" sayilirdi.
  const proSuccessUsers = new Set();
  // Her kullanicinin dosyadaki EN ERKEN olay zamani. Gun numaralarini
  // kullanicinin KENDI baslangicina gore hesaplamak icin gerekli - boylece
  // farkli tarihlerde gelen kullanicilar karsilastirilabilir olur.
  const firstSeenTime = new Map();
  // TRIAL KULLANICILARI: product_id / vendor_product_id icinde "free" gecen
  // satiri olan kullanicilar. Bunlar pro_success uretmedikleri halde abonelere
  // ozgu ekranlara erisebiliyorlar; "abone olmayan" grubuna karisirlarsa o
  // grubun tum sayilarini kirletirler.
  const trialUsers = new Set();
  // Hangi product_id / vendor_product_id degerleri esledi - tespitin dogru
  // calistigini kullanicinin GOZLE dogrulayabilmesi icin.
  const trialMatchedValues = new Map(); // deger -> Set<uid>

  // IMA EDILEN ABONELIK KANITI: dosyanin kapsadigi tarih araligindan ONCE
  // pro_success uretmis olabilecek kullanicilar var - o zaman pro_success
  // satiri dosyada YOK, ama subscription_renewed / subscription_renewal_cancelled
  // veya sadece abonelerin uretebilecegi baska event'ler (ayarlardan
  // tanimlanir) dosyada VAR. Boyle bir event goren kullanici, pro_success
  // satiri olmasa da abone sayilir - aksi halde "abone olmayan" grubuna
  // yanlislikla karisip o grubun butun bulgularini kirletir.
  const impliedSubUsers = new Set();
  const impliedSubEventCounts = new Map(); // event adi -> Set<uid>

  // Renewal/cancel event'leri zaten "abone" davranisidir; ayarlardan
  // eklenen ek event'lerle birlestirilip TEK bir set olarak kontrol edilir.
  const impliedSubEventSet = new Set(
    [cfg.renewalEvent, cfg.cancelEvent, ...(cfg.impliedSubEvents || [])].filter(Boolean)
  );

  let rowCount = 0;
  await parseStream(
    file,
    (row) => {
      rowCount++;
      const uid = getUserId(row, cfg);
      if (!uid) return;

      // Demografik bilgi TÜM satırlardan toplanır (weekly filtresine bakılmaz,
      // cunku ulke/OS/model bir kullanicinin plan tipine bagli degildir).
      const evName = row.event;
      if (evName) eventNameCounts.set(evName, (eventNameCounts.get(evName) || 0) + 1);
      if (evName === cfg.proSuccessEvent) proSuccessUsers.add(uid);

      // IMA EDILEN ABONELIK KANITI: weekly filtresine BAKILMAZ (proSuccessUsers
      // ile ayni mantik) - dosyanin disinda kalan bir pro_success'i telafi
      // etmek icin, plan tipinden bagimsiz her satir taranir.
      if (evName && impliedSubEventSet.has(evName)) {
        impliedSubUsers.add(uid);
        let s = impliedSubEventCounts.get(evName);
        if (!s) { s = new Set(); impliedSubEventCounts.set(evName, s); }
        s.add(uid);
      }

      if (cfg.trialKeywords && cfg.trialKeywords.length) {
        for (const col of cfg.productIdCols) {
          const pv = row[col];
          if (!pv) continue;
          const lower = String(pv).toLowerCase();
          if (cfg.trialKeywords.some((k) => lower.includes(k))) {
            trialUsers.add(uid);
            let s = trialMatchedValues.get(pv);
            if (!s) { s = new Set(); trialMatchedValues.set(pv, s); }
            s.add(uid);
            break;
          }
        }
      }

      const tSeen = getEventTime(row, cfg);
      if (tSeen !== null) {
        const prevSeen = firstSeenTime.get(uid);
        if (prevSeen === undefined || tSeen < prevSeen) firstSeenTime.set(uid, tSeen);
      }

      const country = getFirstNonEmpty(row, cfg.countryCols);
      if (country) bumpCounter(countryCounts, uid, country);
      const osVal = getFirstNonEmpty(row, [cfg.osCol]);
      if (osVal) bumpCounter(osCounts, uid, osVal);
      const model = getFirstNonEmpty(row, cfg.modelCols);
      if (model) bumpCounter(modelCounts, uid, model);

      if (!isWeeklyPlanRow(row, cfg)) return;
      const t = getEventTime(row, cfg);
      if (t === null) return;

      const event = row.event;
      if (event === cfg.proSuccessEvent) {
        const cur = firstProSuccessTime.get(uid);
        if (cur === undefined || t < cur) firstProSuccessTime.set(uid, t);
      } else if (event === cfg.renewalEvent) {
        const cur = firstRenewalTime.get(uid);
        if (cur === undefined || t < cur) firstRenewalTime.set(uid, t);
      } else if (event === cfg.cancelEvent) {
        const cur = firstCancelTime.get(uid);
        if (cur === undefined || t < cur) firstCancelTime.set(uid, t);
      }
    },
    (cursor) => {
      const pct = (cursor / file.size) * 100;
      setProgress(pct, `Pass 1 (tarama): ${rowCount.toLocaleString('tr-TR')} satır tarandı`);
    }
  );

  const renewalGroup = new Map();
  const cancelGroup = new Map();
  const cancelTimeLookup = new Map();

  for (const [uid, t0] of firstProSuccessTime.entries()) {
    const tRenewal = firstRenewalTime.get(uid);
    const tCancel = firstCancelTime.get(uid);

    if (tRenewal === undefined && tCancel === undefined) continue;

    if (tRenewal !== undefined && (tCancel === undefined || tRenewal < tCancel)) {
      renewalGroup.set(uid, { t0, tRenewal });
    } else if (tCancel !== undefined && (tRenewal === undefined || tCancel < tRenewal)) {
      let windowEnd = weekBoundaryEnd(t0, cfg.windowDays);
      if (tRenewal !== undefined && t0 < tRenewal && tRenewal < windowEnd) {
        windowEnd = tRenewal;
      }
      cancelGroup.set(uid, { t0, windowEnd });
      cancelTimeLookup.set(uid, tCancel);
    }
  }

  // Her user icin dominant ulke/OS/model + bunlarin populasyon bazinda frekans tablosu
  const resolvedCountry = new Map();
  const resolvedOs = new Map();
  const resolvedModel = new Map();
  const countryFreq = new Map();
  const osFreq = new Map();
  const modelFreq = new Map();

  for (const uid of firstProSuccessTime.keys()) {
    const c = resolveMode(countryCounts.get(uid));
    const o = resolveMode(osCounts.get(uid));
    const md = resolveMode(modelCounts.get(uid));
    resolvedCountry.set(uid, c);
    resolvedOs.set(uid, o);
    resolvedModel.set(uid, md);
    countryFreq.set(c, (countryFreq.get(c) || 0) + 1);
    osFreq.set(o, (osFreq.get(o) || 0) + 1);
    modelFreq.set(md, (modelFreq.get(md) || 0) + 1);
  }

  if (cfg.trialKeywords && cfg.trialKeywords.length) {
    logLine(`TRIAL TESPITI ("${cfg.trialKeywords.join('", "')}" anahtar kelimesi product_id/vendor_product_id içinde): ` +
      `${trialUsers.size.toLocaleString('tr-TR')} kullanıcı işaretlendi, abone olmayan gruptan çıkarılacak ` +
      `(${trialMatchedValues.size} farklı ürün değeri eşleşti)`);
  }
  {
    const noProInImplied = [...impliedSubUsers].filter((uid) => !proSuccessUsers.has(uid)).length;
    logLine(`İMA EDİLEN ABONELİK KANITI (${[...impliedSubEventSet].join(', ')}): ` +
      `${impliedSubUsers.size.toLocaleString('tr-TR')} kullanıcı işaretlendi, bunların ${noProInImplied.toLocaleString('tr-TR')}'inde dosyada hiç ${cfg.proSuccessEvent} satırı yok ` +
      `(muhtemelen veri başlangıcından önce satın almışlar) — bu kullanıcılar abone olmayan gruptan çıkarılıp abone tarafına geçirildi.`);
  }
  logLine(`PASS 1 tamamlandı. Toplam weekly pro_success user: ${firstProSuccessTime.size.toLocaleString('tr-TR')}`);
  logLine(`  RENEWAL GRUBU (filtresiz): ${renewalGroup.size.toLocaleString('tr-TR')}`);
  logLine(`  CANCEL GRUBU (filtresiz) : ${cancelGroup.size.toLocaleString('tr-TR')}`);

  return {
    renewalGroup, cancelGroup, cancelTimeLookup, totalUsers: firstProSuccessTime.size,
    resolvedCountry, resolvedOs, resolvedModel,
    countryFreq, osFreq, modelFreq, eventNameCounts, proSuccessUsers, firstSeenTime, trialUsers, trialMatchedValues,
    impliedSubUsers, impliedSubEventCounts, impliedSubEventNames: [...impliedSubEventSet],
  };
}

// ---------------- PASS 2 (filtreli kullanicilar icin gun bucket / min coin / image) ----------------

async function pass2(file, cfg, renewalGroup, cancelGroup, cancelTimeLookup, topEventNames, proSuccessUsers, firstSeenTime, trialUsers, impliedSubUsers) {
  logLine('PASS 2: filtrelenmiş kullanıcılar için gün bucket, min coin, image sayısı hesaplanıyor...');

  const allUids = new Set([...renewalGroup.keys(), ...cancelGroup.keys()]);

  const lastEventTime = new Map();
  const minCoins = new Map();
  const maxCoins = new Map();
  const imageGenCount = new Map();
  const activeDaysSet = new Map();
  const dayCoinRange = new Map(); // uid -> Map<dayNum, {min, max}> - o gune ozel coin araligi
  const genInfo = new Map(); // uid -> {firstAttempt:{t,type,ai}, hasSuccess, failCount}
  // Generation Failed sekmesine ozel kopya: custom-image-generation /
  // custom_image_generation turundeki FAIL satirlari bu Map'lere hic girmez,
  // boylece o sekmenin butun hesaplamalari bu turleri gormeden calisir. Diger
  // sekmeler (Genel Analiz vb.) yukaridaki orijinal genInfo/aiByUser'i kullanir.
  const genInfoGF = new Map();
  const aiByUserGF = new Map();
  // GF disleme kumesi: customimagegeneration (hep) + cfg.customAiTypes
  // (varsayilan custom_image_edit/custom-image-edit) - bu turlerin TUM
  // satirlari (basarili + fail) genInfoGF/aiByUserGF/aiByTypeAll/aiDailyAll'a
  // hic islenmez, o sekme bu turleri hic gormemis gibi calisir.
  const gfExcludedAiSet = new Set(['customimagegeneration', ...(cfg.customAiTypes || []).map(normalizeAiName)]);
  // AI TYPE dagilimlari: her tur icin basarili/basarisiz uretim sayilari.
  // byType = pencere icindeki TUM denemeler; firstByType asagida genInfo'dan turetilir.
  const aiByType = new Map(); // ai type -> {fails, oks}
  // AI type'lar donemsel olarak yenilendigi icin gunluk kirilim da tutuluyor:
  // hangi tur hangi tarihlerde kullanildi ve hangi tarihlerde fail verdi.
  const aiDaily = new Map(); // ai type -> Map<gun indeksi, {fails, oks}>

  // --- CANCEL ONCESI SINYAL ANALIZI ICIN ---
  // preCancelSeq: cancel grubundaki her user icin, cancel ANINDAN ONCEKI
  //   event dizisi. Bellegi sinirlamak icin tampon buyudukce budaniyor;
  //   sadece en yeni PRE_CANCEL_KEEP tanesi tutuluyor.
  // userEventInfo: her user icin, SIK GORULEN event adlarinin ilk/son gorulme
  //   zamani ve sayisi (funnel ve tetikleyici analizleri icin). Sadece
  //   pass1'de en sik cikan adlarla sinirli - aksi halde bellek patlar.
  const preCancelSeq = new Map();
  const userEventInfo = new Map();
  // userSeq: ZIYARET duzeyi analiz icin, pencere icindeki olay dizisi.
  // Bellek icin: sadece sik gorulen adlar + kullanici basi ust sinir.
  const userSeq = new Map();
  // --- ABONE OLMAYAN KULLANICILAR ---
  // Hic pro_success yapmamis userlar. Bunlar renewal/cancel gruplarinin
  // disinda kaldigi icin diger tum analizlerde gorunmezler.
  const nonSubEventUsers = new Map();  // event -> Set<uid>
  const nonSubEventCounts = new Map(); // event -> toplam
  const nonSubDays = new Map();        // uid -> Set<gun indeksi>
  const nonSubSpan = new Map();        // uid -> {first, last}
  // Ayni olculer ABONE grubu icin de: Gorsel 33'teki karsilastirma icin sart.
  const subEventUsers = new Map();
  const subEventCounts = new Map();
  const subUserSeen = new Set();
  // Abone olmayanlarin KULLANICI BAZINDA olay ilk-gorulme zamanlari.
  // "Ilk gun sunu yapanlar ertesi gun geri dondu mu" analizi icin sart.
  // Bellek icin kullanici basina en fazla NONSUB_EV_CAP farkli olay tutuluyor.
  const nonSubUserEvents = new Map();
  const NONSUB_EV_CAP = 40;
  // TUM ZAMANLAR AI type sayimi: grup uyeligi ve pencere kisiti OLMADAN,
  // dosyadaki her generation olayini sayar. Ilk hafta tablosuyla yan yana
  // gosterilir - ikisi farkli soruları cevaplar.
  const aiByTypeAll = new Map();  // tur -> {fails, oks}
  const aiDailyAll = new Map();   // tur -> Map<gun, {fails, oks}>
  // KULLANICI BAZINDA tur sayimi (grup uyeleri, pencere ici): boylece ilk
  // hafta tablosu demografik filtreye ve segmente DUYARLI hale gelir.
  const aiByUser = new Map();     // uid -> Map<tur, {fails, oks}>

  // GUN BAZLI OLAY BILESIMI: abone olan vs olmayan, kullanicinin KENDI ilk
  // gununden itibaren. Kova 0..4 = gun 1..5, kova 5 = gun 6-30 toplami.
  // Toplu sayac tutuluyor (kullanici bazinda degil) - bellek acisindan hafif.
  const dayComp = {
    sub: [new Map(), new Map(), new Map(), new Map(), new Map(), new Map()],
    non: [new Map(), new Map(), new Map(), new Map(), new Map(), new Map()],
  };
  const dayCompUsers = {
    sub: [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()],
    non: [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()],
  };
  const seenMap = firstSeenTime instanceof Map ? firstSeenTime : new Map();
  const trialSet = trialUsers instanceof Set ? trialUsers : new Set();
  // Trial kullanicilari HER IKI gruptan da dislanir: pro_success uretmedikleri
  // icin abone sayilamazlar, ama abonelere ozgu davranislari oldugu icin
  // "abone olmayan" grubuna da konamazlar. Ayri sayilip raporlaniyorlar.
  const trialSeen = new Set();
  // subsSet = gercek pro_success VEYA ima edilen abonelik kaniti (renewal/
  // cancel/ekstra event) uretmis TUM kullanicilar. Ikincisi, veri
  // baslangicindan once satin alip pro_success satiri dosyada olmayan
  // kullanicilari da abone tarafina cekmek icin sart - aksi halde bunlar
  // "abone olmayan" grubuna karisip abonelere ozgu event uretiyormus gibi
  // yanlis bir gorunum yaratirlar.
  const impliedSet = impliedSubUsers instanceof Set ? impliedSubUsers : new Set();
  const subsSet = new Set(proSuccessUsers instanceof Set ? proSuccessUsers : []);
  for (const uid of impliedSet) subsSet.add(uid);
  let seqCapped = 0;
  const SEQ_KEEP = 300, SEQ_LIMIT = 900;
  const topSet = topEventNames instanceof Set ? topEventNames : new Set(topEventNames || []);
  const PRE_CANCEL_KEEP = 120;   // budama sonrasi tutulacak
  const PRE_CANCEL_LIMIT = 400;  // bu esige gelince buda

  const day8LastEventTime = new Map();
  const day8MinCoins = new Map();
  const day8ImageGenCount = new Map();

  function getGroupEntry(uid) {
    if (renewalGroup.has(uid)) {
      const g = renewalGroup.get(uid);
      return { t0: g.t0, windowEnd: g.tRenewal };
    }
    const g = cancelGroup.get(uid);
    return { t0: g.t0, windowEnd: g.windowEnd };
  }

  let rowCount = 0;
  await parseStream(
    file,
    (row) => {
      rowCount++;
      const uid = getUserId(row, cfg);
      const tAny = getEventTime(row, cfg);

      // --- GUN BAZLI OLAY BILESIMI (abone vs abone olmayan) ---
      if (uid && tAny !== null && row.event) {
        const fs = seenMap.get(uid);
        if (fs !== undefined) {
          const rel = Math.floor(tAny / SECONDS_PER_DAY) - Math.floor(fs / SECONDS_PER_DAY);
          if (rel >= 0 && rel <= 29 && !trialSet.has(uid)) {
            const bucket = rel <= 4 ? rel : 5;
            const grp = subsSet.has(uid) ? 'sub' : 'non';
            const mp = dayComp[grp][bucket];
            mp.set(row.event, (mp.get(row.event) || 0) + 1);
            dayCompUsers[grp][bucket].add(uid);
          }
        }
      }

      // --- TUM ZAMANLAR AI TYPE: kisit yok ---
      if (tAny !== null) {
        const evName = row.event;
        const isOk = evName === cfg.imageGenEvent;
        const isFl = evName === cfg.imageGenFailedEvent;
        if (isOk || isFl) {
          const aiA = (getFirstNonEmpty(row, cfg.aiTypeCols) || '(belirtilmemiş)');

          // aiByTypeAll/aiDailyAll yalnizca Generation Failed sekmesinde
          // okunuyor - custom-image-generation/custom_image_generation ve
          // cfg.customAiTypes (custom_image_edit/custom-image-edit) turlerindeki
          // TUM satirlar (basarili + fail) burada dogrudan disarida tutuluyor,
          // boylece bu turler o sekmede hic gorunmuyor.
          const excludedGFAllTime = gfExcludedAiSet.has(normalizeAiName(aiA));
          if (!excludedGFAllTime) {
            let ba = aiByTypeAll.get(aiA);
            if (!ba) { ba = { fails: 0, oks: 0 }; aiByTypeAll.set(aiA, ba); }
            if (isOk) ba.oks++; else ba.fails++;

            const dA = Math.floor(tAny / SECONDS_PER_DAY);
            let dmA = aiDailyAll.get(aiA);
            if (!dmA) { dmA = new Map(); aiDailyAll.set(aiA, dmA); }
            let deA = dmA.get(dA);
            if (!deA) { deA = { fails: 0, oks: 0 }; dmA.set(dA, deA); }
            if (isOk) deA.oks++; else deA.fails++;
          }
        }
      }

      // --- ABONE OLMAYANLAR: tum veri suresi boyunca, pencere kisiti YOK ---
      if (uid && tAny !== null && trialSet.has(uid)) trialSeen.add(uid);

      if (uid && tAny !== null && !subsSet.has(uid) && !trialSet.has(uid)) {
        const ev = row.event;
        if (ev) {
          nonSubEventCounts.set(ev, (nonSubEventCounts.get(ev) || 0) + 1);
          let us = nonSubEventUsers.get(ev);
          if (!us) { us = new Set(); nonSubEventUsers.set(ev, us); }
          us.add(uid);
        }
        if (ev) {
          let ue = nonSubUserEvents.get(uid);
          if (!ue) { ue = new Map(); nonSubUserEvents.set(uid, ue); }
          const prev = ue.get(ev);
          if (prev === undefined) { if (ue.size < NONSUB_EV_CAP) ue.set(ev, tAny); }
          else if (tAny < prev) ue.set(ev, tAny);
        }

        const dayIdx = Math.floor(tAny / SECONDS_PER_DAY);
        let ds = nonSubDays.get(uid);
        if (!ds) { ds = new Set(); nonSubDays.set(uid, ds); }
        ds.add(dayIdx);
        const sp = nonSubSpan.get(uid);
        if (!sp) nonSubSpan.set(uid, { first: tAny, last: tAny });
        else { if (tAny < sp.first) sp.first = tAny; if (tAny > sp.last) sp.last = tAny; }
      } else if (uid && tAny !== null && subsSet.has(uid)) {
        // ABONE grubu - ayni sayim (pencere kisiti YOK, tum veri suresi)
        subUserSeen.add(uid);
        const ev = row.event;
        if (ev) {
          subEventCounts.set(ev, (subEventCounts.get(ev) || 0) + 1);
          let us = subEventUsers.get(ev);
          if (!us) { us = new Set(); subEventUsers.set(ev, us); }
          us.add(uid);
        }
      }

      if (!uid || !allUids.has(uid)) return;
      const t = tAny;
      if (t === null) return;

      const { t0, windowEnd } = getGroupEntry(uid);
      const event = row.event;
      const isExcluded = event === cfg.renewalEvent || event === cfg.cancelEvent;

      if (t >= t0 && t < windowEnd) {
        const dayNum = Math.min(cfg.windowDays, dayNumberUTC(t, t0));
        if (event === cfg.imageGenEvent) {
          imageGenCount.set(uid, (imageGenCount.get(uid) || 0) + 1);
        }

        // --- CANCEL ONCESI DIZI TAMPONU (sadece cancel grubu) ---
        if (event && cancelTimeLookup && cancelTimeLookup.has(uid)) {
          const tc = cancelTimeLookup.get(uid);
          if (t < tc) {
            let buf = preCancelSeq.get(uid);
            if (!buf) { buf = []; preCancelSeq.set(uid, buf); }
            buf.push({ t, ev: event });
            if (buf.length >= PRE_CANCEL_LIMIT) {
              buf.sort((a, b) => b.t - a.t);
              preCancelSeq.set(uid, buf.slice(0, PRE_CANCEL_KEEP));
            }
          }
        }

        // --- ZIYARET DUZEYI ICIN OLAY DIZISI ---
        if (event && topSet.has(event)) {
          let sq = userSeq.get(uid);
          if (!sq) { sq = []; userSeq.set(uid, sq); }
          sq.push({ t, ev: event });
          if (sq.length >= SEQ_LIMIT) {
            sq.sort((a, b) => b.t - a.t);
            userSeq.set(uid, sq.slice(0, SEQ_KEEP));
            seqCapped++;
          }
        }

        // --- SIK EVENTLER ICIN ILK/SON GORULME (funnel + tetikleyici) ---
        if (event && topSet.has(event)) {
          let em = userEventInfo.get(uid);
          if (!em) { em = new Map(); userEventInfo.set(uid, em); }
          const rec = em.get(event);
          if (!rec) em.set(event, { first: t, last: t, count: 1 });
          else {
            if (t < rec.first) rec.first = t;
            if (t > rec.last) rec.last = t;
            rec.count++;
          }
        }

        // --- GENERATION DENEME TAKIBI (basari + fail birlikte) ---
        // Satirlar zaman sirali GELMEYEBILIR, o yuzden "ilk deneme"yi
        // dosya sirasina gore degil, ZAMANA gore belirliyoruz.
        const isGenSuccess = event === cfg.imageGenEvent;
        const isGenFail = event === cfg.imageGenFailedEvent;
        if (isGenSuccess || isGenFail) {
          let g = genInfo.get(uid);
          if (!g) { g = { firstAttempt: null, hasSuccess: false, failCount: 0 }; genInfo.set(uid, g); }
          if (isGenSuccess) g.hasSuccess = true;
          if (isGenFail) g.failCount++;

          const aiT = (getFirstNonEmpty(row, cfg.aiTypeCols) || '(belirtilmemiş)');
          let bt = aiByType.get(aiT);
          if (!bt) { bt = { fails: 0, oks: 0 }; aiByType.set(aiT, bt); }
          if (isGenSuccess) bt.oks++; else bt.fails++;

          let ubu = aiByUser.get(uid);
          if (!ubu) { ubu = new Map(); aiByUser.set(uid, ubu); }
          let ue2 = ubu.get(aiT);
          if (!ue2) { ue2 = { fails: 0, oks: 0 }; ubu.set(aiT, ue2); }
          if (isGenSuccess) ue2.oks++; else ue2.fails++;

          const dIdx = Math.floor(t / SECONDS_PER_DAY);
          let dm = aiDaily.get(aiT);
          if (!dm) { dm = new Map(); aiDaily.set(aiT, dm); }
          let de = dm.get(dIdx);
          if (!de) { de = { fails: 0, oks: 0 }; dm.set(dIdx, de); }
          if (isGenSuccess) de.oks++; else de.fails++;

          const type = isGenSuccess ? 'complete' : 'failed';
          if (g.firstAttempt === null || t < g.firstAttempt.t) {
            g.firstAttempt = { t, type, ai: aiT };
          } else if (t === g.firstAttempt.t && type === 'complete') {
            // Ayni saniyede hem complete hem failed varsa complete'i kabul
            // ediyoruz - fail grubunu sismeyen, hipoteze KARSI muhafazakar tercih.
            g.firstAttempt = { t, type, ai: aiT };
          }
          if (isGenFail) {
            if (g.firstFailTime === undefined || t < g.firstFailTime) g.firstFailTime = t;
          }

          // GENERATION FAILED SEKMESI ICIN AYRI KOPYA: custom-image-generation /
          // custom_image_generation ve cfg.customAiTypes (custom_image_edit /
          // custom-image-edit) turundeki TUM satirlar (basarili + fail)
          // genInfoGF/aiByUserGF'e hic islenmez - o sekmenin butun hesaplamalari
          // bu satirlari hic gormemis gibi calisir (bir kullanicinin TUM
          // denemeleri bu turlerdeyse, genInfoGF'de hic girdisi olmaz ve "hic
          // deneme yok" sayilir). Orijinal genInfo/aiByUser yukarida degismeden kaldi.
          const isExcludedForGenFailTab = gfExcludedAiSet.has(normalizeAiName(aiT));
          if (!isExcludedForGenFailTab) {
            let gGF = genInfoGF.get(uid);
            if (!gGF) { gGF = { firstAttempt: null, hasSuccess: false, failCount: 0 }; genInfoGF.set(uid, gGF); }
            if (isGenSuccess) gGF.hasSuccess = true;
            if (isGenFail) gGF.failCount++;
            if (gGF.firstAttempt === null || t < gGF.firstAttempt.t) {
              gGF.firstAttempt = { t, type, ai: aiT };
            } else if (t === gGF.firstAttempt.t && type === 'complete') {
              gGF.firstAttempt = { t, type, ai: aiT };
            }
            if (isGenFail) {
              if (gGF.firstFailTime === undefined || t < gGF.firstFailTime) gGF.firstFailTime = t;
            }

            let ubuGF = aiByUserGF.get(uid);
            if (!ubuGF) { ubuGF = new Map(); aiByUserGF.set(uid, ubuGF); }
            let ueGF = ubuGF.get(aiT);
            if (!ueGF) { ueGF = { fails: 0, oks: 0 }; ubuGF.set(aiT, ueGF); }
            if (isGenSuccess) ueGF.oks++; else ueGF.fails++;
          }
        }

        if (!isExcluded) {
          const cur = lastEventTime.get(uid);
          if (cur === undefined || t > cur) lastEventTime.set(uid, t);

          const coins = getCurrentCoins(row, cfg);
          if (coins !== null) {
            const curMin = minCoins.get(uid);
            if (curMin === undefined || coins < curMin) minCoins.set(uid, coins);
            const curMax = maxCoins.get(uid);
            if (curMax === undefined || coins > curMax) maxCoins.set(uid, coins);
          }

          if (!activeDaysSet.has(uid)) activeDaysSet.set(uid, new Set());
          activeDaysSet.get(uid).add(dayNum);

          if (coins !== null) {
            if (!dayCoinRange.has(uid)) dayCoinRange.set(uid, new Map());
            const perDay = dayCoinRange.get(uid);
            const range = perDay.get(dayNum);
            if (!range) {
              perDay.set(dayNum, { min: coins, max: coins });
            } else {
              if (coins < range.min) range.min = coins;
              if (coins > range.max) range.max = coins;
            }
          }
        }
      }

      const day8Start = weekBoundaryEnd(t0, cfg.windowDays);
      const day8End = day8Start + cfg.day8Seconds;
      if (t >= day8Start && t < day8End) {
        if (event === cfg.imageGenEvent) {
          day8ImageGenCount.set(uid, (day8ImageGenCount.get(uid) || 0) + 1);
        }
        if (!isExcluded) {
          const cur8 = day8LastEventTime.get(uid);
          if (cur8 === undefined || t > cur8) day8LastEventTime.set(uid, t);

          const coins8 = getCurrentCoins(row, cfg);
          if (coins8 !== null) {
            const curMin8 = day8MinCoins.get(uid);
            if (curMin8 === undefined || coins8 < curMin8) day8MinCoins.set(uid, coins8);
          }
        }
      }
    },
    (cursor) => {
      const pct = (cursor / file.size) * 100;
      setProgress(pct, `Pass 2 (analiz): ${rowCount.toLocaleString('tr-TR')} satır tarandı`);
    }
  );

  logLine('PASS 2 tamamlandı.');

  return {
    lastEventTime, minCoins, maxCoins, imageGenCount, activeDaysSet, dayCoinRange, genInfo,
    genInfoGF, aiByUserGF,
    preCancelSeq, userEventInfo, userSeq, seqCapped,
    aiByType, aiDaily, aiByTypeAll, aiDailyAll, aiByUser, dayComp, dayCompUsers, trialSeen,
    nonSubEventUsers, nonSubEventCounts, nonSubDays, nonSubSpan, nonSubUserEvents,
    subEventUsers, subEventCounts, subUserSeen,
    day8LastEventTime, day8MinCoins, day8ImageGenCount,
  };
}

// ---------------- aggregation ----------------

function aggregateGroup(t0Lookup, m, windowDays) {
  const dayBucketCounts = new Map();
  const dayBucketCoins = new Map();
  const dayBucketImages = new Map();
  const extraDay = windowDays + 1; // "gun 8" konsepti - pencere disi ek gozlem dilimi

  const bump = (map, k, v) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  };

  for (const [uid, t0] of t0Lookup.entries()) {
    const lastT = m.lastEventTime.get(uid);
    if (lastT === undefined) continue;
    const day = Math.min(windowDays, dayNumberUTC(lastT, t0));
    dayBucketCounts.set(day, (dayBucketCounts.get(day) || 0) + 1);

    const coins = m.minCoins.get(uid);
    if (coins !== undefined) bump(dayBucketCoins, day, coins);

    bump(dayBucketImages, day, m.imageGenCount.get(uid) || 0);
  }

  for (const [uid, t0] of t0Lookup.entries()) {
    if (!m.day8LastEventTime.has(uid)) continue;
    dayBucketCounts.set(extraDay, (dayBucketCounts.get(extraDay) || 0) + 1);
    const coins8 = m.day8MinCoins.get(uid);
    if (coins8 !== undefined) bump(dayBucketCoins, extraDay, coins8);
    bump(dayBucketImages, extraDay, m.day8ImageGenCount.get(uid) || 0);
  }

  return { dayBucketCounts, dayBucketCoins, dayBucketImages };
}

// ---------------- ADIM 1: Tara ----------------

async function runScan(file) {
  hideAllVisuals();
  clearLog();
  els.emptyState.style.display = 'none';
  els.filterSection.style.display = 'none';
  els.scanBtn.disabled = true;
  els.cookingWrap.style.display = 'flex';
  setProgress(0, 'Başlıyor...');

  const cfg = readConfig();
  const p1 = await pass1(file, cfg);

  if (p1.renewalGroup.size === 0 && p1.cancelGroup.size === 0) {
    logLine('UYARI: kriterlere uyan hiç user bulunamadı.');
    setProgress(100, 'Sonuç yok');
    els.cookingWrap.style.display = 'none';
    els.scanBtn.disabled = false;
    els.emptyState.style.display = 'block';
    els.emptyState.textContent = 'Kriterlere uyan hiç kullanıcı bulunamadı. Ayarlardaki kolon/event adlarını kontrol et.';
    return;
  }

  // Pass 2'yi TUM (filtresiz) populasyon icin BIR KEZ calistiriyoruz ve
  // sonucu onbelleğe alıyoruz. Boylece filtre degistirdikce dosyayi tekrar
  // okumaya gerek kalmiyor - filtreleme artik sadece bellek ici bir Map
  // filtreleme + agregasyon islemi, o yuzden aninda calisiyor.
  // Onceden ilk 60 event ile sinirliydi; bu HEM zararli HEM etkisizdi:
  // hacmi zaten en sik eventler olusturur, nadir olanlari atmak bellekten
  // kayda deger bir sey kazandirmaz - ama tam da ayirt edici (ve bu yuzden
  // en degerli) olaylari disarida birakir. Gercek bellek kontrolu, kullanici
  // basina uygulanan SEQ_LIMIT/SEQ_KEEP siniri.
  // Hicbir kirpma YOK: nadir olaylar (contact_us_click, rate_app_click gibi)
  // tam da en ayirt edici olanlardir. Gercek bellek kontrolu kullanici basina
  // uygulanan SEQ_LIMIT/SEQ_KEEP siniri.
  const topEventNames = new Set(p1.eventNameCounts.keys());
  const m = await pass2(file, cfg, p1.renewalGroup, p1.cancelGroup, p1.cancelTimeLookup, topEventNames, p1.proSuccessUsers, p1.firstSeenTime, p1.trialUsers, p1.impliedSubUsers);
  setProgress(100, 'Tarama + hesaplama tamamlandı');
  els.cookingWrap.style.display = 'none';

  state = { file, cfg, p1, m, csX: 20, csExclude: '', csSignal: null, csF1: null, csF2: null, csF3: null, csF4: null,
    csC1: null, csC2: null, csC3: null, csComboN: 15,
    csRiskEvent: null, csRiskEvents: 20, csRiskMinutes: 120,
    csDistEventBin: 1, csDistEventCap: 50, csDistMinuteBin: 5, csDistMinuteCap: 120, nsTopN: 15, csPrecN: 10, nsMinSpan: 7, aiSegment: 'all', nsDayTopN: 10 };
  renderFilterUI(p1);
  populateSignalControls(p1.eventNameCounts);
  els.filterSection.style.display = 'block';
  els.scanBtn.disabled = false;
  logLine('Tarama tamamlandı. Filtreleri değiştirdikçe grafikler anında güncellenecek.');

  runFilteredAnalysis(); // varsayilan (hepsi secili) filtreyle ilk render - dosya okumasi yok, ani
}

