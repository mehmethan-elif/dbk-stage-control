import {
  folderForSong,
  libraryFileUrl,
  loadLibraryIndex,
  readSongFile,
  readSongJsonFile,
  registerSongFolder,
  resetSongFolders,
  setLibraryFileOverride,
  writeSongJsonFile,
  type LibraryIndex
} from "../native/library";

export interface LibraryApi {
  loadIndex(): Promise<LibraryIndex>;
  fileUrl(songId: string, path: string): Promise<string>;
  readBytes(songId: string, path: string): Promise<ArrayBuffer>;
  readJson(songId: string, path: string): Promise<unknown | null>;
  writeJson(songId: string, path: string, data: unknown): Promise<void>;
}

export const libraryApi: LibraryApi = {
  loadIndex: loadLibraryIndex,
  fileUrl: libraryFileUrl,
  readBytes: readSongFile,
  readJson: readSongJsonFile,
  writeJson: writeSongJsonFile
};

export {
  folderForSong,
  registerSongFolder,
  resetSongFolders,
  setLibraryFileOverride
};
export type { LibraryIndex };
