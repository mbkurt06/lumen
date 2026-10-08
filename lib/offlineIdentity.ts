"use client";

import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

const OFFLINE_USER_KEY="lumen-offline-user-v1";

type OfflineUserSnapshot={
  id:string;
  email?:string|null;
  phone?:string|null;
  aud?:string;
  role?:string;
  app_metadata?:Record<string,unknown>;
  user_metadata?:Record<string,unknown>;
  created_at?:string;
  updated_at?:string;
};

export function cacheOfflineUser(user:User | OfflineUserSnapshot | null){
  if(typeof window==="undefined") return;
  try{
    if(!user){
      localStorage.removeItem(OFFLINE_USER_KEY);
      return;
    }
    const snapshot:OfflineUserSnapshot={
      id:user.id,
      email:user.email ?? null,
      phone:(user as any).phone ?? null,
      aud:(user as any).aud || "authenticated",
      role:(user as any).role || "authenticated",
      app_metadata:{...((user as any).app_metadata || {})},
      user_metadata:{...((user as any).user_metadata || {})},
      created_at:(user as any).created_at || new Date().toISOString(),
      updated_at:(user as any).updated_at || new Date().toISOString(),
    };
    localStorage.setItem(OFFLINE_USER_KEY,JSON.stringify(snapshot));
  }catch{}
}

export function readOfflineUser():User|null{
  if(typeof window==="undefined") return null;
  try{
    const raw=localStorage.getItem(OFFLINE_USER_KEY);
    if(!raw) return null;
    const snapshot=JSON.parse(raw) as OfflineUserSnapshot;
    if(!snapshot?.id) return null;
    return {
      id:snapshot.id,
      email:snapshot.email ?? undefined,
      phone:snapshot.phone ?? undefined,
      aud:snapshot.aud || "authenticated",
      role:snapshot.role || "authenticated",
      app_metadata:snapshot.app_metadata || {},
      user_metadata:snapshot.user_metadata || {},
      created_at:snapshot.created_at || "",
      updated_at:snapshot.updated_at || snapshot.created_at || "",
      identities:[],
      factors:[],
    } as unknown as User;
  }catch{
    return null;
  }
}

export async function getOfflineOwnerId(){
  try{
    const {data}=await supabase.auth.getSession();
    const id=data.session?.user?.id;
    if(id){
      cacheOfflineUser(data.session!.user);
      return id;
    }
  }catch{}
  return readOfflineUser()?.id ?? null;
}
