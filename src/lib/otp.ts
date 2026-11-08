// WhatsApp phone verification: pure helpers + Firestore calls (browser-only, call from handlers/effects).
import { cloud } from "./cloud";

export const OTP_TTL_MS = 15 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export type OtpCode = { code: string; used: boolean };
export type OtpRequest = { id: string; phone: string; status: "pending" | "sent" | "verified"; createdAt?: number; sentAt?: number; attempts: number };

/** "0300-1234567" -> "03001234567" (doc id). */
export const phoneKey = (phone: string) => phone.replace(/\D/g, "");
/** Pakistani local number -> international digits for wa.me. */
export const waDigits = (phone: string) => { const d = phoneKey(phone); return d.startsWith("0") ? "92" + d.slice(1) : d; };

export function generateCodes(n = 100, rand = Math.random): OtpCode[] {
  const seen = new Set<string>();
  while (seen.size < n) seen.add(String(Math.floor(100000 + rand() * 900000)));
  return [...seen].map((code) => ({ code, used: false }));
}
export function pickCode(codes: OtpCode[], rand = Math.random): string | undefined {
  const free = codes.filter((c) => !c.used);
  return free.length ? free[Math.floor(rand() * free.length)].code : undefined;
}
export const markUsed = (codes: OtpCode[], code: string) => codes.map((c) => (c.code === code ? { ...c, used: true } : c));
export const otpExpired = (sentAt: number | undefined, now = Date.now()) => !sentAt || now - sentAt > OTP_TTL_MS;
export const attemptsLeft = (attempts: number) => Math.max(0, OTP_MAX_ATTEMPTS - attempts);

const ms = (v: unknown) => (v && typeof (v as { toMillis?: () => number }).toMillis === "function" ? (v as { toMillis: () => number }).toMillis() : undefined);

// ---- user side ----
export async function requestOtp(phone: string) {
  const { db, fs } = await cloud();
  const id = phoneKey(phone);
  await fs.setDoc(fs.doc(db, "otpRequests", id), { phone: phone.trim(), status: "pending", attempts: 0, createdAt: fs.serverTimestamp() });
}
export async function isPhoneVerified(phone: string) {
  const { db, fs } = await cloud();
  return (await fs.getDoc(fs.doc(db, "verifiedPhones", phoneKey(phone)))).exists();
}
/** Returns "ok", "wrong", "expired", "locked" or "notsent". Firestore rules compare the code with the hidden secret. */
export async function confirmOtp(phone: string, code: string): Promise<"ok" | "wrong" | "expired" | "locked" | "notsent"> {
  const { db, fs } = await cloud();
  const id = phoneKey(phone);
  const reqRef = fs.doc(db, "otpRequests", id);
  const snap = await fs.getDoc(reqRef);
  if (!snap.exists()) return "notsent";
  const r = snap.data() as { status: string; attempts: number; sentAt?: unknown };
  if (r.status === "verified" || (await isPhoneVerified(phone))) return "ok";
  if (r.status !== "sent") return "notsent";
  if (otpExpired(ms(r.sentAt))) return "expired";
  if (r.attempts >= OTP_MAX_ATTEMPTS) return "locked";
  const guess = code.trim();
  const attempt = { guess, attempts: r.attempts + 1 };
  try {
    const b = fs.writeBatch(db);
    b.update(reqRef, { ...attempt, status: "verified" });
    b.set(fs.doc(db, "verifiedPhones", id), { code: guess, verifiedAt: fs.serverTimestamp() });
    await b.commit();
    return "ok";
  } catch {
    // Wrong code: record the failed attempt so the limit applies.
    await fs.updateDoc(reqRef, attempt).catch(() => {});
    return r.attempts + 1 >= OTP_MAX_ATTEMPTS ? "locked" : "wrong";
  }
}
export async function loadOtpWhatsapp(): Promise<string> {
  const { db, fs } = await cloud();
  const s = await fs.getDoc(fs.doc(db, "settings", "otp"));
  return (s.data()?.whatsapp as string) ?? "";
}

// ---- admin side ----
export async function saveOtpWhatsapp(whatsapp: string) {
  const { db, fs } = await cloud();
  await fs.setDoc(fs.doc(db, "settings", "otp"), { whatsapp: whatsapp.trim() }, { merge: true });
}
export async function loadPool(): Promise<OtpCode[]> {
  const { db, fs } = await cloud();
  return ((await fs.getDoc(fs.doc(db, "otpPool", "main"))).data()?.codes as OtpCode[]) ?? [];
}
export async function savePool(codes: OtpCode[]) {
  const { db, fs } = await cloud();
  await fs.setDoc(fs.doc(db, "otpPool", "main"), { codes });
}
export async function watchRequests(cb: (r: OtpRequest[]) => void) {
  const { db, fs } = await cloud();
  return fs.onSnapshot(fs.collection(db, "otpRequests"), (snap) =>
    cb(snap.docs.map((d) => { const x = d.data(); return { id: d.id, phone: x.phone, status: x.status, attempts: x.attempts ?? 0, createdAt: ms(x.createdAt), sentAt: ms(x.sentAt) }; })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))));
}
/** Picks a random unused code, remembers it for this number, marks it used. Returns the code. */
export async function assignCode(req: OtpRequest): Promise<string> {
  const { db, fs } = await cloud();
  const codes = await loadPool();
  const code = pickCode(codes);
  if (!code) throw new Error("no-codes");
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, "otpSecrets", req.id), { code, sentAt: fs.serverTimestamp() });
  b.set(fs.doc(db, "otpPool", "main"), { codes: markUsed(codes, code) });
  b.update(fs.doc(db, "otpRequests", req.id), { status: "sent", attempts: 0, sentAt: fs.serverTimestamp() });
  await b.commit();
  return code;
}
export async function deleteRequest(id: string) {
  const { db, fs } = await cloud();
  await fs.deleteDoc(fs.doc(db, "otpRequests", id));
}
