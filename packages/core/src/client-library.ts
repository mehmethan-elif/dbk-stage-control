export const CLIENT_LIBRARY_NAME = "DBK Stage Control";

export interface ClientLibraryFile {
  path: string;
  size: number;
  hash: string;
}

export interface ClientLibrarySong {
  id: string;
  folder: string;
  files: ClientLibraryFile[];
}

export interface ClientLibraryIndex {
  name: string;
  songs: ClientLibrarySong[];
  gigs?: ClientLibraryFile;
}

export function needsClientLibraryDownload(
  local: { size: number; hash?: string } | undefined,
  remote: { size: number; hash: string }
): boolean {
  if (!local) return true;
  if (local.hash && remote.hash) return local.hash !== remote.hash;
  return local.size !== remote.size;
}
