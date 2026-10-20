"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { User, api, ApiError } from "@/lib/api";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();

  // `logout` is captured by `refreshAccessToken` and by the cross-tab listener.
  // Using a ref keeps a single stable identity without the stale-closure bug
  // that a `useCallback(..., [])` over a re-created `logout` would introduce.
  const logoutRef = useRef<() => Promise<void>>(async () => {});

  const clearSession = useCallback(async () => {
    setUser(null);
    try {
      await api.logout();
    } catch {
      // Ignore logout errors; clear local state anyway.
    }
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
    router.replace("/login");
    router.refresh();
  }, [clearSession, router]);

  logoutRef.current = logout;

  const storeSession = useCallback((data: { access_token: string; refresh_token: string; user?: User }) => {
    if (data.user) setUser(data.user);
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    try {
      const data = await api.refreshToken();
      storeSession(data);
      return true;
    } catch (err) {
      console.error("Token refresh failed:", err);
      await logoutRef.current();
      return false;
    }
  }, [storeSession]);

  // Keep the API client's in-client refresh and this context in sync. Without
  // this, a silent refresh inside `api` updated localStorage while the context
  // kept serving stale tokens.
  useEffect(() => {
    api.setTokenRefreshListener((tokens) => {
      storeSession(tokens);
    });
    return () => api.setTokenRefreshListener(null);
  }, [storeSession]);

  // Bootstrap the session on mount.
  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      if (typeof window === "undefined") {
        if (!cancelled) setIsLoading(false);
        return;
      }

      try {
        // The auth cookies are HttpOnly and cannot be inspected by JavaScript.
        // Ask the API to validate them instead of guessing from document.cookie.
        const profile = await api.getMe();
        if (cancelled) return;
        setUser(profile);
      } catch (err) {
        if (cancelled) return;
        if (!(err instanceof ApiError && err.status === 401)) {
          console.error("Failed to restore the current session:", err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    initAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      await clearSession();
      try {
        const data = await api.login(email, password);
        storeSession(data);
        router.replace(data.user?.role?.toLowerCase() === "admin" ? "/admin" : "/");
        router.refresh();
      } catch (error) {
        await clearSession();
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [clearSession, storeSession, router]
  );

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
