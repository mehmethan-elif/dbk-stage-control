export function holdLibraryLoading(): boolean {
  return new URLSearchParams(window.location.search).has("loading");
}

export function LibraryLoading({ status }: { status?: string | null }) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="brand">DBK STAGE</div>
      <div className="brand-name">ELIF AVCI</div>
      <div className="app-loading-status">{status?.trim() || "Loading library…"}</div>
    </div>
  );
}
