export const DIRECTA_UPLOAD_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxManualInputsBytes: 64 * 1024,
} as const;

export function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`;
}

export function totalUploadBytes(files: Array<{ size: number }>): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}
