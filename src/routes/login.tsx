import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { AuthLogo } from "@/components/AppShell";
import { getState } from "@/lib/store";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login — Travel Sync" },
      { name: "description", content: "Log in to your verified Travel Sync account." },
      { property: "og:title", content: "Login — Travel Sync" },
      { property: "og:description", content: "Log in to Travel Sync." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Login,
});

function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const forgot = async () => {
    setErr(""); setInfo("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Enter your email above, then tap Forgot password");
    try {
      const { resetPassword } = await import("@/lib/cloud");
      await resetPassword(email);
      setInfo("Password reset link sent. Check your email inbox (and spam folder).");
    } catch (x) {
      const code = (x as { code?: string }).code;
      setErr(code === "auth/user-not-found" ? "No account with this email" : code === "auth/too-many-requests" ? "Too many tries. Please wait a few minutes." : "Could not send reset link. Try again.");
    }
  };
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { signIn } = await import("@/lib/cloud");
      await signIn(email, pass);
      const s = getState();
      if (s.admin) { nav({ to: "/admin" }); return; }
      if (!s.user) { setErr("Account not found or deactivated by admin"); return; }
      nav({ to: "/" });
    } catch { setErr("Wrong email or password"); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="pb-4"><AuthLogo imgSize="h-24 w-24" textSize="text-6xl" animated /></div>
      <input className="field" type="email" autoCapitalize="none" autoCorrect="off" autoComplete="email" placeholder="Official email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <PasswordInput placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
      <button type="button" onClick={forgot} className="-mt-2 self-end text-sm font-semibold text-primary">Forgot password?</button>
      {err && <p className="font-semibold text-destructive">{err}</p>}
      {info && <p className="font-semibold text-success">{info}</p>}
      <button className="btn-big" disabled={busy}>{busy ? "Logging in…" : "Login"}</button>
      <p className="py-2 text-center text-muted-foreground">Don't have an account? <Link to="/register" className="font-bold text-primary">Sign up</Link></p>
    </form>
  );
}
