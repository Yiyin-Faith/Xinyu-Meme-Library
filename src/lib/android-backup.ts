import { registerPlugin, type Plugin, type PluginListenerHandle } from '@capacitor/core';
import { backupManifestText, createBackupSnapshot, getBackupImage } from './backup';

type NativeBackupDirectory = {
  cancelled: boolean;
  treeUri?: string;
  folderName?: string;
  location?: string;
};

type NativeWriter = { writerId: string };
type NativeCompressedBackup = { zipUri: string; zipName: string; location: string };

interface BackupExportPlugin extends Plugin {
  chooseDirectory(options: { folderName: string }): Promise<NativeBackupDirectory>;
  openFile(options: { treeUri: string; folderName: string; path: string; mimeType: string }): Promise<NativeWriter>;
  writeChunk(options: { writerId: string; data: string }): Promise<void>;
  closeFile(options: { writerId: string }): Promise<void>;
  compress(options: { treeUri: string; folderName: string; zipFileName: string }): Promise<NativeCompressedBackup>;
}

const NativeBackupExport = registerPlugin<BackupExportPlugin>('BackupExport');
const COPY_CHUNK_BYTES = 128 * 1024;

export type AndroidBackupProgress =
  | { phase: 'selecting' }
  | { phase: 'copying'; completed: number; total: number; bytesCompleted: number; totalBytes: number; location: string }
  | { phase: 'raw-complete'; completed: number; total: number; bytesCompleted: number; totalBytes: number; location: string }
  | { phase: 'compressing'; completed: number; total: number; bytesCompleted: number; totalBytes: number; location: string };

export type AndroidBackupResult =
  | { kind: 'cancelled' }
  | { kind: 'complete'; rawLocation: string; zipLocation: string; zipName: string }
  | { kind: 'raw-only'; rawLocation: string; compressionError: string };

export class AndroidBackupCopyError extends Error {
  constructor(message: string, readonly location: string) { super(message); }
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}

async function writeBlob(
  treeUri: string,
  folderName: string,
  path: string,
  mimeType: string,
  blob: Blob,
  onBytes: (bytes: number) => void,
) {
  const { writerId } = await NativeBackupExport.openFile({ treeUri, folderName, path, mimeType });
  let closed = false;
  try {
    if (blob.stream) {
      const reader = blob.stream().getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        for (let offset = 0; offset < next.value.length; offset += COPY_CHUNK_BYTES) {
          const chunk = next.value.subarray(offset, Math.min(offset + COPY_CHUNK_BYTES, next.value.length));
          await NativeBackupExport.writeChunk({ writerId, data: toBase64(chunk) });
          onBytes(chunk.length);
        }
      }
    } else {
      for (let offset = 0; offset < blob.size; offset += COPY_CHUNK_BYTES) {
        const chunk = new Uint8Array(await blob.slice(offset, offset + COPY_CHUNK_BYTES).arrayBuffer());
        await NativeBackupExport.writeChunk({ writerId, data: toBase64(chunk) });
        onBytes(chunk.length);
      }
    }
    await NativeBackupExport.closeFile({ writerId });
    closed = true;
  } finally {
    if (!closed) {
      try { await NativeBackupExport.closeFile({ writerId }); } catch { /* Preserve the partial file if Android has already closed it. */ }
    }
  }
}

function localDateStamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * Android-only export path. It never builds a whole-library ArrayBuffer, ZIP,
 * or Base64 string in WebView memory: each Blob is streamed to a user-selected
 * persistent folder, then the native side streams that folder into a ZIP.
 */
export async function exportAndroidBackup(onProgress: (progress: AndroidBackupProgress) => void): Promise<AndroidBackupResult> {
  const stamp = localDateStamp();
  const folderName = `xinyu-backup-${stamp}`;
  const zipFileName = `${folderName}.puff.zip`;
  onProgress({ phase: 'selecting' });
  const destination = await NativeBackupExport.chooseDirectory({ folderName });
  if (destination.cancelled) return { kind: 'cancelled' };
  if (!destination.treeUri || !destination.folderName || !destination.location) throw new Error('未能创建外部备份目录');

  const snapshot = await createBackupSnapshot();
  const total = snapshot.manifest.memes.length;
  let completed = 0;
  let bytesCompleted = 0;
  let lastProgressAt = 0;
  const updateCopyProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 90) return;
    lastProgressAt = now;
    onProgress({ phase: 'copying', completed, total, bytesCompleted, totalBytes: snapshot.totalBytes, location: destination.location! });
  };

  try {
    updateCopyProgress(true);
    for (const meme of snapshot.manifest.memes) {
      const blob = await getBackupImage(meme.id);
      await writeBlob(destination.treeUri, destination.folderName, `images/${meme.id}`, meme.mime, blob, (bytes) => {
        bytesCompleted += bytes;
        updateCopyProgress();
      });
      completed++;
      updateCopyProgress(true);
    }
    await writeBlob(
      destination.treeUri,
      destination.folderName,
      'manifest.json',
      'application/json',
      new Blob([backupManifestText(snapshot)], { type: 'application/json' }),
      () => undefined,
    );
  } catch (error) {
    throw new AndroidBackupCopyError(`原始备份未完成：${asErrorMessage(error)}`, destination.location);
  }

  onProgress({ phase: 'raw-complete', completed, total, bytesCompleted, totalBytes: snapshot.totalBytes, location: destination.location });
  let listener: PluginListenerHandle | undefined;
  try {
    listener = await NativeBackupExport.addListener('compressionProgress', (event: { completed?: number; total?: number; bytesCompleted?: number; totalBytes?: number }) => {
      onProgress({
        phase: 'compressing',
        completed: event.completed ?? completed,
        total: event.total ?? total,
        bytesCompleted: event.bytesCompleted ?? bytesCompleted,
        totalBytes: event.totalBytes ?? snapshot.totalBytes,
        location: destination.location!,
      });
    });
    onProgress({ phase: 'compressing', completed: 0, total, bytesCompleted: 0, totalBytes: snapshot.totalBytes, location: destination.location });
    const zip = await NativeBackupExport.compress({ treeUri: destination.treeUri, folderName: destination.folderName, zipFileName });
    return { kind: 'complete', rawLocation: destination.location, zipLocation: zip.location, zipName: zip.zipName };
  } catch (error) {
    return { kind: 'raw-only', rawLocation: destination.location, compressionError: asErrorMessage(error) };
  } finally {
    await listener?.remove();
  }
}
