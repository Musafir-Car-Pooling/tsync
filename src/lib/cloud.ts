// Lovable Cloud sync layer: the database is the source of truth, store.ts is the in-memory view.
// Browser-only: every export is called from effects or event handlers.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { pickDemoInterests, getState, setRemote, setWriteHook, type Company, type Interest, type Post, type Settings, type State, type StoredReview, type ChatMessage, type Unlock, type User } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
const db = supabase as any;

export const unlockId = (payerId: string, interestId: string) => `${payerId}_${interestId}`;
const log = (e: unknown) => console.warn("[cloud]", e);
const ok = <T,>(r: { data: T; error: unknown }) => { if (r.error) throw r.error; return r.data; };
const channelName = (n: string) => `${n}-${Math.random().toString(36).slice(2)}`;

async function currentUid() { const { data } = await supabase.auth.getSession(); return data.session?.user.id ?? null; }

// ---------- Auth ----------
export class AuthError extends Error { constructor(public code: string, msg: string) { super(msg); } }

/** Creates the account. Returns "confirm" when the member must click the email link first. */
export async function registerAccount(user: Omit<User, "id">): Promise<"signed-in" | "confirm"> {
  const profile = profileDoc({ ...user, id: "" });
  const { data, error } = await supabase.auth.signUp({
    email: user.email, password: user.password,
    options: { emailRedirectTo: window.location.origin + "/login", data: { profile, phone: user.phone } },
  });
  if (error) throw new AuthError(/already/i.test(error.message) ? "email-in-use" : "failed", error.message);
  if (data.user && (data.user.identities?.length ?? 0) === 0) throw new AuthError("email-in-use", "Email already registered");
  if (!data.session) return "confirm";
  await ensureProfile();
  await waitForProfile();
  return "signed-in";
}

export async function signIn(email: string, password: string) {
  const e = email.trim().toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({ email: e, password });
  if (error) throw error;
  await ensureProfile();
  await waitForProfile();
}

/** Admin console sign-in; the first sign-in with the admin email creates that account. */
export async function adminSignIn(email: string, password: string): Promise<"signed-in" | "confirm"> {
  const e = email.trim().toLowerCase();
  const r = await supabase.auth.signInWithPassword({ email: e, password });
  if (!r.error) { await waitForProfile(); return "signed-in"; }
  if (/confirm/i.test(r.error.message)) return "confirm";
  const s = await supabase.auth.signUp({ email: e, password, options: { emailRedirectTo: window.location.origin + "/admin" } });
  if (s.error) throw s.error;
  if (!s.data.session) return "confirm";
  await waitForProfile();
  return "signed-in";
}

/** First sign-in after email confirmation: create the profile saved at sign-up. */
async function ensureProfile() {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return;
  const existing = ok(await db.from("profiles").select("id").eq("id", u.id).maybeSingle());
  if (existing) return;
  const meta = (u.user_metadata ?? {}) as { profile?: Json; phone?: string };
  if (!meta.profile) return; // admin or legacy account without sign-up data
  await db.from("profiles").insert({ id: u.id, data: { ...meta.profile, email: u.email }, active: true, verified: !!meta.profile.verified }).then(ok);
  if (meta.phone) await db.from("private_phones").upsert({ id: u.id, phone: meta.phone }).then(ok);
  void refreshProfile(u.id);
}

function waitForProfile() {
  return new Promise<void>((res) => {
    const t0 = Date.now();
    const tick = () => { const s = getState(); if (s.admin || s.user || Date.now() - t0 > 8000) res(); else setTimeout(tick, 100); };
    tick();
  });
}

export async function changePassword(current: string, next: string) {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error("Not signed in");
  const check = await supabase.auth.signInWithPassword({ email, password: current });
  if (check.error) throw check.error;
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw error;
}

// ---------- Live sync ----------
let started = false;
let postDocs: Post[] = [];
let interests: Record<string, Interest[]> = {};
const unsentPosts = new Set<string>();
const markUnsent = () => setRemote((s) => ({ ...s, unsent: [...unsentPosts] }));
const rebuildPosts = () => setRemote((s) => ({ ...s, posts: postDocs.map((p) => ({ ...p, interests: interests[p.id] ?? [] })) }));

const rowPost = (r: Json): Post => ({ ...(r.data as Post), id: r.id, ownerId: r.owner_id, active: r.active, interests: [] });
const rowUser = (r: Json, phone = ""): User => ({ ...(r.data as User), id: r.id, active: r.active, verified: r.verified, password: "", phone });
const rowUnlock = (r: Json): Unlock => ({ ...(r.data as Unlock), id: r.id, userId: r.user_id, interestId: r.interest_id, postId: r.post_id, kind: r.kind, status: r.status });
const rowReview = (r: Json): StoredReview => ({ ...(r.data as StoredReview), id: r.id, reviewerId: r.reviewer_id, targetId: r.target_id, rating: r.rating, text: r.text });

/**
 * Share a new ride/request and wait for the server to confirm it, because only confirmed
 * posts reach other members. Resolves "queued" after 8s without confirmation; throws when rejected.
 */
export async function sharePost(p: Post): Promise<"sent" | "queued"> {
  const uid = await currentUid();
  if (!uid || uid !== p.ownerId) throw new Error("Please sign in again before sharing.");
  unsentPosts.add(p.id); markUnsent();
  postDocs = [...postDocs.filter((x) => x.id !== p.id), { ...p, interests: [] }];
  setRemote((s) => ({ ...s, posts: [...s.posts.filter((x) => x.id !== p.id), p] }));
  const write = db.from("posts").insert(postRow(p)).then(ok) as Promise<unknown>;
  write.then(async () => {
    unsentPosts.delete(p.id); markUnsent(); rebuildPosts();
    const demos = pickDemoInterests(p, getState().settings).map(({ id, ...rest }) => ({ post_id: p.id, id, data: rest }));
    if (demos.length) await db.from("interests").upsert(demos).then(ok).catch(log);
    void refreshInterests();
  }, (e: unknown) => {
    log(e);
    unsentPosts.delete(p.id); markUnsent();
    postDocs = postDocs.filter((x) => x.id !== p.id);
    setRemote((s) => ({ ...s, posts: s.posts.filter((x) => x.id !== p.id) }));
  });
  return Promise.race([write.then(() => "sent" as const), new Promise<"queued">((r) => setTimeout(() => r("queued"), 8000))]);
}

let session: { uid: string; admin: boolean } | null = null;

async function refreshPosts() {
  if (!session) return;
  const rows = ok(await db.from("posts").select("*")) as Json[];
  const ids = new Set(rows.map((r) => r.id));
  postDocs = [...rows.map(rowPost), ...postDocs.filter((p) => unsentPosts.has(p.id) && !ids.has(p.id))];
  rebuildPosts();
}
async function refreshInterests() {
  if (!session) return;
  const rows = ok(await db.from("interests").select("*")) as Json[];
  const next: Record<string, Interest[]> = {};
  for (const r of rows) (next[r.post_id] ??= []).push({ ...(r.data as Interest), id: r.id });
  for (const k of Object.keys(next)) next[k]!.sort((a, b) => a.at - b.at);
  interests = next;
  rebuildPosts();
}
async function refreshProfile(uid: string) {
  const row = ok(await db.from("profiles").select("*").eq("id", uid).maybeSingle()) as Json;
  if (!row) return;
  const priv = ok(await db.from("private_phones").select("phone").eq("id", uid).maybeSingle()) as Json;
  const u = rowUser(row, priv?.phone ?? "");
  if (!u.active) { await supabase.auth.signOut(); return; }
  setRemote((s) => ({ ...s, user: u, users: [u], seenIntro: true, authReady: true }));
}
async function refreshUsers() {
  const rows = ok(await db.from("profiles").select("*")) as Json[];
  setRemote((s) => ({ ...s, users: rows.map((r) => rowUser(r)) }));
}
async function refreshUnlocks() {
  if (!session) return;
  const q = db.from("unlocks").select("*");
  const rows = ok(await (session.admin ? q : q.eq("user_id", session.uid))) as Json[];
  const unlocks = rows.map(rowUnlock);
  setRemote((s) => ({ ...s, unlocks }));
  if (session.admin) return;
  for (const u of unlocks.filter((u) => u.status === "unlocked" && u.kind !== "chat" && !getState().phones[u.interestId])) {
    db.from("private_phones").select("phone").eq("id", u.interestId).maybeSingle().then((r: Json) => {
      const phone = r.data?.phone as string | undefined;
      if (phone) setRemote((s) => ({ ...s, phones: { ...s.phones, [u.interestId]: phone } }));
    }, log);
  }
}
async function refreshReviews() {
  const rows = ok(await db.from("reviews").select("*")) as Json[];
  setRemote((s) => ({ ...s, memberReviews: rows.map(rowReview) }));
}
async function refreshCatalogs() {
  const st = ok(await db.from("app_settings").select("*").eq("id", "app").maybeSingle()) as Json;
  if (st) setRemote((s) => ({ ...s, settings: { ...s.settings, ...(st.data as Partial<Settings>) } }));
  const cs = ok(await db.from("companies").select("*")) as Json[];
  if (cs.length) setRemote((s) => ({ ...s, companies: cs.map((r) => ({ ...(r.data as Company), id: r.id })) }));
}

export async function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  setWriteHook((prev, next) => { void writeDiff(prev, next).catch(log); });

  void refreshCatalogs().catch(log);
  supabase.channel(channelName("catalogs"))
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => void refreshCatalogs().catch(log))
    .on("postgres_changes", { event: "*", schema: "public", table: "companies" }, () => void refreshCatalogs().catch(log))
    .subscribe();

  let channel: RealtimeChannel | null = null;
  // Backup delivery: mobile networks can stall the live stream, so re-read on resume, online and every 20s.
  let lastRefresh = 0;
  const refreshAll = (force = false) => {
    if (!session || document.visibilityState === "hidden") return;
    if (!force && Date.now() - lastRefresh < 5000) return;
    lastRefresh = Date.now();
    void refreshPosts().catch(log); void refreshInterests().catch(log); void refreshUnlocks().catch(log);
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAll(true); });
  window.addEventListener("online", () => refreshAll(true));
  window.addEventListener("focus", () => refreshAll());
  setInterval(() => refreshAll(true), 20000);

  let currentUid: string | null | undefined;
  const onSession = async (uid: string | null) => {
    if (uid === currentUid) return;
    currentUid = uid;
    if (channel) { void supabase.removeChannel(channel); channel = null; }
    postDocs = []; interests = {}; session = null;
    if (!uid) { setRemote((s) => ({ ...s, user: null, admin: false, users: [], posts: [], unlocks: [], phones: {}, memberReviews: [], authReady: true })); return; }
    const roles = ok(await db.from("user_roles").select("role").eq("user_id", uid)) as Json[];
    const admin = roles.some((r) => r.role === "admin");
    session = { uid, admin };
    if (admin) { setRemote((s) => ({ ...s, admin: true, user: null, authReady: true })); void refreshUsers().catch(log); }
    else { await ensureProfile().catch(log); await refreshProfile(uid).catch(log); setRemote((s) => ({ ...s, authReady: true })); }
    refreshAll(true); void refreshReviews().catch(log);
    channel = supabase.channel(channelName("app"))
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => void refreshPosts().catch(log))
      .on("postgres_changes", { event: "*", schema: "public", table: "interests" }, () => void refreshInterests().catch(log))
      .on("postgres_changes", { event: "*", schema: "public", table: "unlocks" }, () => void refreshUnlocks().catch(log))
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews" }, () => void refreshReviews().catch(log))
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void (admin ? refreshUsers() : refreshProfile(uid)).catch(log))
      .subscribe();
  };
  supabase.auth.onAuthStateChange((_e, s) => { setTimeout(() => void onSession(s?.user.id ?? null), 0); });
  const { data } = await supabase.auth.getSession();
  void onSession(data.session?.user.id ?? null);
}

// ---------- Writes: mirror local changes into the database ----------
function profileDoc(u: User) {
  const { password: _p, phone: _ph, id: _id, ...rest } = u;
  return rest;
}
function postRow(p: Post) {
  const { interests: _i, id, ownerId, active, ...rest } = p;
  return { id, owner_id: ownerId, active, data: rest };
}
function byId<T extends { id: string }>(list: T[]) { return new Map(list.map((x) => [x.id, x])); }

async function writeDiff(prev: State, next: State) {
  const me = await currentUid();
  const ops: Promise<unknown>[] = [];
  const run = (p: PromiseLike<Json>) => ops.push(Promise.resolve(p).then(ok).catch(log));

  if ((prev.user && !next.user) || (prev.admin && !next.admin)) { await supabase.auth.signOut(); return; }

  if (next.admin && prev.settings !== next.settings) run(db.from("app_settings").upsert({ id: "app", data: next.settings }));

  if (next.admin && prev.companies !== next.companies) {
    const after = byId(next.companies);
    run(db.from("companies").upsert(next.companies.map(({ id, ...rest }) => ({ id, data: rest }))));
    const gone = prev.companies.filter((c) => !after.has(c.id)).map((c) => c.id);
    if (gone.length) run(db.from("companies").delete().in("id", gone));
  }

  if (prev.posts !== next.posts) {
    const before = byId(prev.posts);
    const after = byId(next.posts);
    for (const p of next.posts) {
      const old = before.get(p.id);
      if (old === p) continue;
      if (old && (p.ownerId === me || next.admin) && JSON.stringify(postRow(old)) !== JSON.stringify(postRow(p))) {
        const { id, ...row } = postRow(p);
        run(db.from("posts").update(row).eq("id", id));
      }
      for (const i of p.interests) {
        if (i.id === me && !old?.interests.some((x) => x.id === me)) { const { id, phone: _ph, ...rest } = i; run(db.from("interests").upsert({ post_id: p.id, id, data: rest })); }
      }
    }
    for (const p of prev.posts) {
      const n = after.get(p.id);
      if (!n) continue;
      for (const i of p.interests) if (i.id === me && !n.interests.some((x) => x.id === i.id)) run(db.from("interests").delete().eq("post_id", p.id).eq("id", i.id));
    }
    for (const p of prev.posts) if (!after.has(p.id) && (p.ownerId === me || next.admin) && !unsentPosts.has(p.id)) run(db.from("posts").delete().eq("id", p.id));
  }

  if (prev.unlocks !== next.unlocks) {
    const before = byId(prev.unlocks);
    for (const u of next.unlocks) {
      if (before.get(u.id) === u) continue;
      if (next.admin) run(db.from("unlocks").update({ status: u.status }).eq("id", u.id));
      else if (u.userId === me) {
        const { id, userId, interestId, postId, kind, status, ...rest } = u;
        run(db.from("unlocks").upsert({ id, user_id: userId, interest_id: interestId, post_id: postId, kind: kind ?? "phone", status, data: rest }));
      }
    }
  }

  if (prev.users !== next.users || prev.user !== next.user) {
    const before = byId(prev.users);
    const changed = next.users.filter((u) => before.get(u.id) !== u);
    if (next.user && prev.user !== next.user && !changed.some((u) => u.id === next.user?.id)) changed.push(next.user);
    for (const u of changed) {
      if (u.id === me || next.admin) run(db.from("profiles").update({ data: profileDoc(u), active: u.active, verified: u.verified }).eq("id", u.id));
      const oldPhone = before.get(u.id)?.phone ?? prev.user?.phone;
      if (u.id === me && u.phone && u.phone !== oldPhone) run(db.from("private_phones").upsert({ id: u.id, phone: u.phone }));
    }
  }
  await Promise.all(ops);
}

export async function submitReview(targetId: string, rating: number, text: string) {
  const uid = await currentUid();
  const me = getState().user;
  if (!uid || !me) throw new Error("Not signed in");
  const t = text.trim().slice(0, 500);
  await db.from("reviews").upsert({ id: `${uid}_${targetId}`, reviewer_id: uid, target_id: targetId, rating, text: t, data: { reviewerName: me.name, at: Date.now() } }).then(ok);
  void refreshReviews();
}

// ---------- Demo members (admin only) ----------
export async function saveDemoPhone(id: string, phone: string) { await db.from("private_phones").upsert({ id: "demo_" + id, phone }).then(ok); }
export async function loadDemoPhone(id: string) {
  const r = ok(await db.from("private_phones").select("phone").eq("id", "demo_" + id).maybeSingle()) as Json;
  return (r?.phone as string | undefined) ?? "";
}
export async function deleteDemoPhone(id: string) { await db.from("private_phones").delete().eq("id", "demo_" + id).then(ok); }

// ---------- In-app chat (members who hide their number) ----------
// Thread id = unlock id "<payer>_<member>"; only those two can read/write once the chat unlock is approved.
const rowMsg = (r: Json): ChatMessage => ({ id: r.id, from: r.from_id, text: r.text, at: Number(r.at), deliveredAt: r.delivered_at ? Number(r.delivered_at) : undefined, readAt: r.read_at ? Number(r.read_at) : undefined } as ChatMessage);

export async function sendChat(chatId: string, text: string) {
  const from = await currentUid();
  if (!from) throw new Error("Not signed in");
  await db.from("chat_messages").insert({ chat_id: chatId, from_id: from, text: text.trim().slice(0, 1000), at: Date.now() }).then(ok);
}
export function watchChat(chatId: string, cb: (m: ChatMessage[]) => void, onError: (e: unknown) => void): () => void {
  let dead = false;
  const load = () => db.from("chat_messages").select("*").eq("chat_id", chatId).order("at").then((r: Json) => {
    if (dead) return;
    if (r.error) onError(r.error); else cb((r.data as Json[]).map(rowMsg));
  });
  void load();
  const ch = supabase.channel(channelName("chat"))
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chatId}` }, () => void load())
    .subscribe();
  return () => { dead = true; void supabase.removeChannel(ch); };
}
/** Chats other members opened with me (I hid my number). */
export function watchIncomingChats(uid: string, cb: (u: Unlock[]) => void): () => void {
  let dead = false;
  const load = () => db.from("unlocks").select("*").eq("interest_id", uid).eq("kind", "chat").eq("status", "unlocked").then((r: Json) => {
    if (!dead && !r.error) cb((r.data as Json[]).map(rowUnlock));
  });
  void load();
  const ch = supabase.channel(channelName("incoming"))
    .on("postgres_changes", { event: "*", schema: "public", table: "unlocks" }, () => void load())
    .subscribe();
  return () => { dead = true; void supabase.removeChannel(ch); };
}
/** Mark the other person's messages delivered/read (WhatsApp-style ticks). */
export async function markChatSeen(chatId: string, msgs: ChatMessage[], field: "deliveredAt" | "readAt") {
  const me = await currentUid();
  if (!me) return;
  const todo = msgs.filter((m) => m.from !== me && !m[field]);
  if (!todo.length) return;
  const now = Date.now();
  await Promise.all(todo.map((m) => db.from("chat_messages").update(field === "readAt" ? { read_at: now, delivered_at: m.deliveredAt ?? now } : { delivered_at: now }).eq("id", m.id).eq("chat_id", chatId))).catch(log);
}

/** Saves this phone's notification token for the signed-in member. */
export async function savePushToken(id: string, token: string) {
  const uid = await currentUid();
  if (!uid) throw new Error("Sign in before enabling notifications.");
  await db.from("push_tokens").upsert({ id, user_id: uid, token, updated_at: Date.now() }).then(ok);
}
