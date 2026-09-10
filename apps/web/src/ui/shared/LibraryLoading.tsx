export function holdLibraryLoading(): boolean {
  return new URLSearchParams(window.location.search).has("loading");
}

export function LibraryLoading({ status }: { status?: string | null }) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="brand">DBK STAGE</div>
      <div className="brand-name">ELIF AVCI</div>
      <div className="app-loading-status">{status?.trim() || "Loading library…"}</div>
      <div className="app-loading-install">
        <div className="app-loading-install-title">iPad ilk kurulum</div>
        <ol>
          <li>
            Bu yükleme sayfası kaybolup DBK STAGE — ELIF AVCI uygulama sayfası
            geldiğinde Safari’de “Paylaş” düğmesine dokunun.
          </li>
          <li>Çıkan menüden Ana Ekrana Ekle’yi seçin, sonra Ekle’ye basın.</li>
          <li>iPad’inizin ana ekranında DBK uygulaması simgesi oluşturulacaktır.</li>
          <li>Bundan sonra uygulamayı bu simge ile açacaksınız.</li>
          <li>Uygulama ilk açıldığında gerekli kütüphaneleri indirir. Bitene kadar bekleyin.</li>
        </ol>
      </div>
      <div className="app-loading-install">
        <div className="app-loading-install-title">Android tablet ilk kurulum</div>
        <ol>
          <li>
            Bu yükleme sayfası kaybolup DBK STAGE — ELIF AVCI uygulama sayfası
            geldiğinde Chrome’da sağ üstteki menü (üç nokta) düğmesine dokunun.
          </li>
          <li>
            Çıkan menüden Ana ekrana ekle’yi (veya Uygulamayı yükle’yi) seçin, sonra
            Ekle’ye basın.
          </li>
          <li>Tabletinizin ana ekranında DBK uygulaması simgesi oluşturulacaktır.</li>
          <li>Bundan sonra uygulamayı bu simge ile açacaksınız.</li>
          <li>Uygulama ilk açıldığında gerekli kütüphaneleri indirir. Bitene kadar bekleyin.</li>
        </ol>
      </div>
    </div>
  );
}
