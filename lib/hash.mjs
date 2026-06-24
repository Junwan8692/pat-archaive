// 브라우저·Node(>=18) 공용: globalThis.crypto.subtle
export async function sha256Hex(str) {
  const data = new TextEncoder().encode(String(str));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
