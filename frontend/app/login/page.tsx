"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Layers, Lock, Mail, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBanner, PANEL_CLASS, PanelTitle } from "@/components/ui/panel";
import { BRAND_GRADIENT } from "@/components/Navbar";
import { errorMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";

const SIGN_IN_FALLBACK = "Unable to sign in. Verify your email and password and try again.";

export default function LoginPage() {
  const { user, login, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const emailId = React.useId();
  const passwordId = React.useId();

  // The root layout owns the app-wide `metadata`; this route is a client
  // component, so Next.js disallows exporting its own `metadata` object here.
  useEffect(() => {
    document.title = "Sign in · Enterprise Operations Hub";
  }, []);

  useEffect(() => {
    if (!isAuthLoading && user) {
      router.replace(user.role?.toLowerCase() === "admin" ? "/admin" : "/");
    }
  }, [user, isAuthLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 423) {
        setError(`Your account is temporarily locked after too many unsuccessful sign-in attempts. ${err.message}`);
      } else {
        setError(errorMessage(err, SIGN_IN_FALLBACK));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Background decoration */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/3 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div
            style={{ backgroundImage: BRAND_GRADIENT }}
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl shadow-primary"
          >
            <Layers size={28} className="text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Operations Hub Login
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to manage batches, faculty utilization, and quality checkpoints
          </p>
        </div>

        {/* Login Form */}
        <div className={cn(PANEL_CLASS, "p-5 sm:p-6")}>
          <PanelTitle
            title="Sign in"
            description="Use your corporate email address and password."
          />

          {error && (
            <ErrorBanner message={error} className="mt-4" />
          )}

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-5">
            <div className="space-y-1.5">
              <Label htmlFor={emailId} className="block text-foreground">
                Corporate Email Address
              </Label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="pl-10 pr-3"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={passwordId} className="block text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id={passwordId}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="pl-10 pr-14"
                  required
                  autoComplete="current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword
                    ? <EyeOff size={18} aria-hidden="true" />
                    : <Eye size={18} aria-hidden="true" />}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <a
                href="/forgot-password"
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </a>
            </div>

            <Button type="submit" loading={isLoading} size="lg" className="mt-2 w-full">
              <span>{isLoading ? "Signing in..." : "Sign in"}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
