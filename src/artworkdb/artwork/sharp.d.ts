declare module 'sharp' {
  interface SharpInstance {
    metadata(): Promise<{ width?: number; height?: number; format?: string }>;
    ensureAlpha(): SharpInstance;
    raw(): SharpInstance;
    toBuffer(options: { resolveWithObject: true }): Promise<{
      data: Buffer;
      info: { width: number; height: number; channels: number; size: number };
    }>;
  }
  function sharp(input: Buffer | Uint8Array): SharpInstance;
  export default sharp;
}
