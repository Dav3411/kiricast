"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

export function useFetchAccessToken() {
  return useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }, []);
}

export function useFetchWithAuth() {
  const fetchAccessToken = useFetchAccessToken();

  const fetchWithAuth = useCallback(
    async (input: string, init: RequestInit = {}) => {
      const token = await fetchAccessToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    [fetchAccessToken]
  );

  return { fetchAccessToken, fetchWithAuth };
}
