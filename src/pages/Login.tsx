import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { lastLogin, rememberLogin, trAuthError } from "../lib/auth";
import { isNative } from "../lib/update";

export function Login() {
  const [email, setEmail] = useState(() => lastLogin()?.email ?? "");
  const [remember, setRemember] = useState(isNative());
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(trAuthError(error.message));
    else rememberLogin(email.trim(), remember ? password : null);
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="card loginbox" onSubmit={submit}>
        <div className="avatar big">L</div>
        <h1>Lumen</h1>
        <label>
          E-posta
          <input type="email" name="email" id="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Şifre
          <input type={show ? "text" : "password"} name="password" id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Şifreyi göster
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Bu cihazda beni hatırla
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "Giriş yapılıyor…" : "Giriş yap"}</button>
      </form>
    </div>
  );
}
