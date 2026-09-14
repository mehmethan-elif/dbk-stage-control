export function LibraryMissing(props: { master: boolean }) {
  return (
    <div className="role-gate">
      <div className="brand">No songs on this iPad</div>
      <p className="role-gate-copy">
        Connect the iPad to a Mac, open Finder, select the iPad, then copy your <code>library</code> folder into{" "}
        <strong>DBK Stage Control</strong>.
      </p>
      <p className="role-gate-help">
        The folder must contain <code>songs</code>, same as on your computer. {props.master
          ? "Master plays stems from this copy. Publish the band library from the Mac."
          : "Use the browser page on band tablets. It downloads the published library."}
      </p>
    </div>
  );
}
