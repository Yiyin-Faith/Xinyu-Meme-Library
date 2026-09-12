import { Capacitor, registerPlugin, type Plugin } from '@capacitor/core';
import { assembleBackup, describeBackupLayoutProblem, normalizeBackupLayout, type Backup, type BackupImageSource } from './backup';

type NativeFolderEntry = { path: string; size: number };
type NativeBackupFolder = { cancelled: boolean; treeUri?: string; location?: string; entries?: NativeFolderEntry[] };
type NativeReadHandle = { readerId: string; size: number };
type NativeChunk = { data: string; done: boolean };

/**
 * The restore half of the same native plugin used for export. It deliberately
 * speaks in relative paths plus `content://` tree URIs: the native side keeps
 * the DocumentFile handle, so nothing ever needs a real filesystem path.
 */
interface BackupRestorePlugin extends Plugin {
  chooseBackupFolder(): Promise<NativeBackupFolder>;
  openFileForRead(options: { treeUri: string; path: string }): Promise<NativeReadHandle>;
  readChunk(options: { readerId: string; length: number }): Promise<NativeChunk>;
  closeReader(options: { readerId: string }): Promise<void>;
}

const NativeBackupRestore = registerPlugin<BackupRestorePlugin>('BackupExport');
const READ_CHUNK_BYTES = 192 * 1024;

export const isAndroidFolderRestoreAvailable = Capacitor.getPlatform() === 'android';

export type AndroidBackupFolder = { treeUri: string; location: string; entries: NativeFolderEntry[] };

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Streams one file out of the picked folder. One image is in flight at a time. */
async function readFolderFile(treeUri: string, path: string): Promise<Blob> {
  const { readerId } = await NativeBackupRestore.openFileForRead({ treeUri, path });
  const parts: Uint8Array<ArrayBuffer>[] = [];
  try {
    for (;;) {
      const chunk = await NativeBackupRestore.readChunk({ readerId, length: READ_CHUNK_BYTES });
      if (chunk.data) parts.push(fromBase64(chunk.data));
      if (chunk.done) break;
    }
  } finally {
    try { await NativeBackupRestore.closeReader({ readerId }); } catch { /* Android may already have closed it. */ }
  }
  return new Blob(parts, { type: '' });
}

/** Opens the Storage Access Framework folder picker. `undefined` means cancelled. */
export async function pickAndroidBackupFolder(): Promise<AndroidBackupFolder | undefined> {
  if (!isAndroidFolderRestoreAvailable) return undefined;
  const picked = await NativeBackupRestore.chooseBackupFolder();
  if (picked.cancelled) return undefined;
  if (!picked.treeUri) throw new Error('未能读取所选备份文件夹');
  return { treeUri: picked.treeUri, location: picked.location || '所选备份文件夹', entries: picked.entries ?? [] };
}

/**
 * Reads a backup that is still an uncompressed folder (`manifest.json` plus
 * `images/<sha256>`), directly from user storage. It reuses the ZIP restore's
 * layout whitelist and its `assembleBackup` core, so size / MIME / SHA-256 /
 * dimension / collection checks and every error message are identical whether
 * the user picked a ZIP or a folder.
 */
export async function readAndroidBackupFolder(folder: AndroidBackupFolder, onProgress?: (completed: number, total: number) => void, checkDimensions = true): Promise<Backup> {
  const layout = normalizeBackupLayout(folder.entries.map((entry) => entry.path));
  const problem = describeBackupLayoutProblem(layout);
  if (problem) throw new Error(problem);
  const manifestKey = layout.manifestKey;
  if (!manifestKey) throw new Error('备份中未找到 manifest.json，请选择心语表情库导出的备份（ZIP 或备份文件夹）');
  const manifestText = await (await readFolderFile(folder.treeUri, manifestKey)).text();
  const sizes = new Map(folder.entries.map((entry) => [entry.path, entry.size]));
  const sources = new Map<string, BackupImageSource>();
  for (const [id, path] of layout.images) {
    const size = sizes.get(path);
    if (size === undefined) continue;
    sources.set(id, { size, load: () => readFolderFile(folder.treeUri, path) });
  }
  return assembleBackup(manifestText, sources, checkDimensions, onProgress);
}
