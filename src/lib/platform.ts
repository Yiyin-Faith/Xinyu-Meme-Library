import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Meme } from '../types';

export const isAndroid = Capacitor.getPlatform() === 'android';
export const isDesktop = !!window.puffDesktop;
export const platformName = isDesktop ? 'Windows 客户端' : isAndroid ? 'Android 客户端' : '浏览器体验版';
export function extension(mime: string) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'application/zip': 'zip' } as Record<string, string>)[mime] || 'png'; }
export function safeFilename(name: string) { return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100); }
async function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
}
export async function saveBlob(blob: Blob, name: string): Promise<boolean> {
  if (window.puffDesktop) return window.puffDesktop.saveFile(Array.from(new Uint8Array(await blob.arrayBuffer())), safeFilename(name));
  if (isAndroid) {
    const result = await Filesystem.writeFile({ path: `puff/${safeFilename(name)}`, data: await base64(blob), directory: Directory.Cache, recursive: true });
    await Share.share({ title: name, files: [result.uri], dialogTitle: '保存或发送文件' });
    return true;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = safeFilename(name); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
export async function pngBlob(blob: Blob) {
  if (blob.type === 'image/png') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('图片转换失败')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
export async function useImage(meme: Pick<Meme, 'blob' | 'mime' | 'title'>, forceShare = false) {
  if (window.puffDesktop && !forceShare) {
    if (meme.mime === 'image/gif' || meme.mime === 'image/webp') {
      const saved = await saveBlob(meme.blob, `${safeFilename(meme.title)}.${extension(meme.mime)}`);
      return saved ? '已保存原图，可拖到聊天窗口发送，动画保持不变' : '已取消保存';
    }
    const png = await pngBlob(meme.blob);
    await window.puffDesktop.copyImage(Array.from(new Uint8Array(await png.arrayBuffer())), 'image/png');
    return '图片已复制，可以粘贴到聊天窗口';
  }
  const name = `${safeFilename(meme.title)}.${extension(meme.mime)}`;
  if (isAndroid) {
    const shareBlob = meme.mime === 'image/svg+xml' ? await pngBlob(meme.blob) : meme.blob;
    const result = await Filesystem.writeFile({ path: `puff/share-${Date.now()}.${extension(shareBlob.type)}`, data: await base64(shareBlob), directory: Directory.Cache, recursive: true });
    await Share.share({ files: [result.uri], title: meme.title, dialogTitle: '发送这个表情' });
    return '已打开系统分享';
  }
  const file = new File([meme.blob], name, { type: meme.mime });
  if (forceShare && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return '分享完成'; }
  if (forceShare) { await saveBlob(meme.blob, name); return '已下载原图，可以发送到聊天窗口'; }
  if (meme.mime === 'image/gif' || meme.mime === 'image/webp') {
    await saveBlob(meme.blob, name);
    return '已下载原图，保留动画；可以发送此文件';
  }
  if (!navigator.clipboard?.write) throw new Error('此浏览器不支持图片复制，请使用右侧下载按钮');
  // Promise payload keeps the original click activation available to the Clipboard API.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(meme.blob) })]);
  return '图片已复制';
}
