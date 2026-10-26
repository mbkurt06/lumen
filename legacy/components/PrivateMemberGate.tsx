"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";

const LOCAL_APPROVAL_KEY = "lumen-private-approved-user-v1";
type AccessState = "checking" | "allowed" | "denied";

function previouslyApproved(id: string): boolean {
  try { return localStorage.getItem(LOCAL_APPROVAL_KEY) === id; }
  catch { return false; }
}

export function PrivateMemberGate({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [access, setAccess] = useState<AccessState>("checking");

  useEffect(() => {
    let active = true;

    async function verify() {
      // Offline use only works after this device has verified its account online.
      if (!navigator.onLine) {
        if (active) setAccess(previouslyApproved(user.id) ? "allowed" : "denied");
        return;
      }
      if (active) setAccess("checking");

      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || auth.user?.id !== user.id) {
          if (active) setAccess(previouslyApproved(user.id) ? "allowed" : "denied");
          return;
        }
        const { data: membership, error } = await supabase
          .from("private_app_members")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!active) return;
        if (error) {
          setAccess(previouslyApproved(user.id) ? "allowed" : "denied");
          return;
        }
        const allowed = membership?.user_id === user.id;
        try {
          if (allowed) localStorage.setItem(LOCAL_APPROVAL_KEY, user.id);
          else localStorage.removeItem(LOCAL_APPROVAL_KEY);
        } catch {}
        setAccess(allowed ? "allowed" : "denied");
      } catch {
        if (active) setAccess(previouslyApproved(user.id) ? "allowed" : "denied");
      }
    }

    void verify();
    window.addEventListener("online", verify);
    window.addEventListener("offline", verify);
    return () => {
      active = false;
      window.removeEventListener("online", verify);
      window.removeEventListener("offline", verify);
    };
  }, [user.id]);

  function signOut() {
    try { localStorage.removeItem(LOCAL_APPROVAL_KEY); } catch {}
    onSignOut();
  }

  if (access === "allowed") return <AppShell user={user} onSignOut={signOut} />;

  return (
    <main style={{ maxWidth: 520, margin: "12vh auto", padding: 24, textAlign: "center" }}>
      <h1>Lumen</h1>
      <p role="status">
        {access === "checking"
          ? "Hesabın erişim izni doğrulanıyor…"
          : navigator.onLine
            ? "Bu hesap kişisel uygulamaya erişim için yetkilendirilmemiş."
            : "Çevrimdışı erişim için bu cihazda önce bir kez internet üzerinden giriş yapılmalı."}
      </p>
      {access === "denied" && (
        <button type="button" onClick={signOut}>Çıkış yap / başka hesapla giriş yap</button>
      )}
    </main>
  );
}
