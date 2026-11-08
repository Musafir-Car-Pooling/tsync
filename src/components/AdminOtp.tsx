import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { assignCode, deleteRequest, generateCodes, loadOtpWhatsapp, loadPool, otpExpired, saveOtpWhatsapp, savePool, waDigits, watchRequests, type OtpCode, type OtpRequest } from "@/lib/otp";

export function AdminOtp() {
  const [wa, setWa] = useState("");
  const [codes, setCodes] = useState<OtpCode[]>([]);
  const [reqs, setReqs] = useState<OtpRequest[]>([]);
  const [msg, setMsg] = useState("");
  const [showCodes, setShowCodes] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    loadOtpWhatsapp().then(setWa).catch(() => {});
    loadPool().then(setCodes).catch(() => setMsg("Could not load codes"));
    watchRequests(setReqs).then((u) => (off = u)).catch(() => setMsg("Could not load requests"));
    return () => off?.();
  }, []);

  const free = codes.filter((c) => !c.used).length;
  const send = async (r: OtpRequest) => {
    // Open the window first so mobile browsers don't block it as a popup.
    const w = window.open("about:blank", "_blank");
    try {
      const code = await assignCode(r);
      const text = encodeURIComponent(`Travel Sync verification code: ${code}\nValid for 15 minutes.`);
      const url = `https://wa.me/${waDigits(r.phone)}?text=${text}`;
      if (w) w.location.href = url; else window.location.href = url;
      setCodes(await loadPool());
      setMsg("");
    } catch (e) {
      w?.close();
      setMsg((e as Error).message === "no-codes" ? "No unused codes left. Generate new codes." : "Could not send code");
    }
  };

  return (
    <div className="space-y-4">
      <section className="card-box space-y-2 p-4">
        <h3 className="font-display text-xl">WhatsApp number for codes</h3>
        <div className="flex gap-2">
          <input className="field" placeholder="03xx-xxxxxxx" value={wa} onChange={(e) => setWa(e.target.value)} />
          <Button type="button" onClick={() => saveOtpWhatsapp(wa).then(() => setMsg("Saved")).catch(() => setMsg("Could not save"))} className="h-auto shrink-0 px-4">Save</Button>
        </div>
        <p className="text-sm text-muted-foreground">Users are told their code comes from this number. Open the admin panel on this phone to send codes.</p>
      </section>

      <section className="card-box space-y-2 p-4">
        <h3 className="font-display text-xl">Codes list</h3>
        <p className="text-sm">{codes.length} codes · <b>{free}</b> unused · {codes.length - free} used</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={async () => { if (codes.length && !confirm("Replace the current codes with 100 new ones?")) return; const c = generateCodes(); await savePool(c).then(() => setCodes(c)).catch(() => setMsg("Could not save codes")); }}>Generate 100 codes</Button>
          <Button type="button" variant="secondary" onClick={() => setShowCodes(!showCodes)}>{showCodes ? "Hide" : "Show"} codes</Button>
        </div>
        {showCodes && <div className="grid grid-cols-4 gap-1 text-sm tabular-nums">{codes.map((c) => <span key={c.code} className={c.used ? "text-muted-foreground line-through" : ""}>{c.code}</span>)}</div>}
      </section>

      {msg && <p className="font-semibold text-destructive">{msg}</p>}

      <section className="space-y-2">
        <h3 className="font-display text-xl">Verification requests</h3>
        {reqs.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
        {reqs.map((r) => {
          const expired = r.status === "sent" && otpExpired(r.sentAt);
          const label = r.status === "verified" ? "Verified" : expired ? "Expired" : r.status === "sent" ? `Code sent · ${r.attempts}/5 tries` : "Waiting for code";
          return (
            <div key={r.id} className="card-box flex items-center justify-between gap-2 p-3">
              <div><p className="font-semibold">{r.phone}</p><p className="text-xs text-muted-foreground">{label}{r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString()}` : ""}</p></div>
              <div className="flex gap-2">
                {r.status === "pending" && <Button type="button" size="sm" onClick={() => send(r)}>Send code</Button>}
                {r.status !== "pending" && <Button type="button" size="sm" variant="ghost" onClick={() => deleteRequest(r.id)}>Remove</Button>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
