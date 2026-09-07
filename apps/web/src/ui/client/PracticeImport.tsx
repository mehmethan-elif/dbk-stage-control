type Props = {
  compact?: boolean;
  onImported?: () => void;
};

export function PracticeImport(props: {
  importZip: (file: Blob) => Promise<void>;
  importFolder: (files: Iterable<File>) => Promise<void>;
  busy?: string | null;
} & Props) {
  const run = async (work: () => Promise<void>) => {
    await work();
    props.onImported?.();
  };

  return (
    <div className={`practice-import${props.compact ? " is-compact" : ""}`}>
      <label className="lyrics-btn on client-file-btn">
        Import zip
        <input
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void run(() => props.importZip(file));
          }}
        />
      </label>
      <label className="lyrics-btn client-file-btn">
        Use this folder
        <input
          type="file"
          hidden
          multiple
          // @ts-expect-error webkitdirectory is valid in Chromium / Safari
          webkitdirectory=""
          onChange={(event) => {
            const list = event.target.files;
            event.target.value = "";
            if (list && list.length > 0) void run(() => props.importFolder(list));
          }}
        />
      </label>
      {props.busy ? <p className="meta">{props.busy}</p> : null}
    </div>
  );
}
