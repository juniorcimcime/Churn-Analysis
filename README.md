# Churn Analysis Dashboard

Mixpanel event verisinden churn, retention ve LTV analizi yapan, bağımlılıksız (zero-dependency) bir dashboard. Weekly/yearly subscription ve coin ekonomisi olan bir mobil AI görsel üretim uygulaması için geliştirilmiştir.

## Nasıl çalıştırılır

1. Bu repoyu klonlayın veya indirin
2. Kendi Mixpanel CSV export'unuzu projeye ekleyin (veya `sample_data/sample_1day.csv` örneğiyle deneyin)
3. Terminalde:
   ```
   npx serve .
   ```
4. Tarayıcıda `localhost:3000` adresini açın, CSV'yi dashboard'a yükleyin

## Beklenen veri formatı

Dashboard, Mixpanel'den export edilmiş event bazlı bir CSV bekler. Önemli event ve alanlar:

- `pro_success` — abonelik başlangıcı
- `subscription_renewal` / `subscription_renewal_cancelled` — yenileme/iptal
- `ai_type` — üretilen içerik tipi
- `price_usd`, `current_usd` — gelir/bakiye alanları
- `campaign`, `af_adset`, `af_channel` vb. — AppsFlyer kampanya attribution alanları

Kolon ve event isimleri `js/01-config.js` içinde merkezi olarak tanımlıdır; farklı bir şemayla çalışıyorsanız burayı güncelleyin.

## Örnek veri

`sample_data/sample_1day.csv` — gerçek verinin 1 günlük, kullanıcı ID'leri anonimleştirilmiş bir kesiti. Veri formatını görmek ve dashboard'u hızlıca denemek için kullanılabilir.

## Yapı

- `js/` — modüler dashboard mantığı (Pass 1 / Pass 2 data engine, sekmeler, istatistik fonksiyonları)
- `python/` — panel veri (GEE / mixed-effects) modelleri için Python köprü scripti
- `sample_data/` — örnek/anonimleştirilmiş veri

## Notlar

- Tüm istatistiksel hesaplamalar (KM eğrileri, log-rank testi, lojistik regresyon, Mann-Whitney U, GMM) JS tarafında bağımlılıksız olarak yazılmıştır; sadece panel veri gerektiren mixed-effects/GEE modelleri için ayrı bir Python scripti kullanılır.
- Gerçek kullanıcı verinizi bu repoya (özellikle public ise) yüklemeyin — `.gitignore` bu amaçla `*.csv` ve `data/` klasörünü hariç tutar.
