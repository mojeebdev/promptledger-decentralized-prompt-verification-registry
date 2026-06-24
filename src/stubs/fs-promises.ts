// Stub for node:fs/promises — browser uploads use MemData instead of ZgFile
export const open = async () => {
  throw new Error('fs.open is not available in browser. Use MemData for in-memory uploads.');
};
export const readFile = async () => Buffer.alloc(0);
export const writeFile = async () => {};
export const mkdir = async () => {};
export default { open, readFile, writeFile, mkdir };