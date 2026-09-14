import { stageHomeScreenRole } from "./sync-host";

/**
 * Band members keep two home screen icons: the published page they practise from at home, and
 * the master's own page they join the stage with. Both come out of the same build, so without
 * this they would land on the home screen as two identical icons with the same name. Safari
 * reads the icon and the title when "Add to Home Screen" is tapped, so setting them at boot is
 * early enough, and an icon already on the home screen keeps whatever it was added with.
 *
 * Android ignores all of that and reads the manifest instead, so the manifest gets swapped too.
 */
export function markHomeScreenRole(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const stage = stageHomeScreenRole();
  const name = stage ? "DBK Stage" : "DBK Practice";

  document.title = stage ? "DBK Stage" : "DBK Stage Control";
  const title = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (title instanceof HTMLMetaElement) title.content = name;

  // Relative to the page so it resolves under the Pages sub-path and the master alike.
  const asset = (file: string) =>
    new URL(file, new URL(import.meta.env.BASE_URL || "/", window.location.href)).href;

  const icon = document.querySelector('link[rel="apple-touch-icon"]');
  if (icon instanceof HTMLLinkElement) icon.href = asset(stage ? "icon-stage.png" : "icon-practice.png");

  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest instanceof HTMLLinkElement) {
    manifest.href = asset(stage ? "manifest-stage.webmanifest" : "manifest.webmanifest");
  }
}
