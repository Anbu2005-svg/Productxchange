"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, setToken, getToken } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { AlertCircle, Eye, EyeOff, Lock, Mail, ArrowLeft } from "lucide-react";

function getSafeRedirectUrl(url: string | null): string {
  if (!url) return "/";
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) {
    return url;
  }
  return "/";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const resetTokenParam = searchParams.get("reset_token");

  // Mode: "login" | "forgot" | "reset"
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (resetTokenParam) {
      setMode("reset");
      return;
    }

    if (typeof window !== "undefined" && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get("access_token");
      const hashError = hashParams.get("error_description") || hashParams.get("error");
      if (hashError) {
        setError(hashError);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
      if (accessToken) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setGoogleLoading(true);
        api("/auth/supabase/oauth-login", {
          method: "POST",
          body: JSON.stringify({ supabase_access_token: accessToken }),
        })
          .then(() => {
            setToken();
            showToast("Signed in with Google", "success");
            const redirect = getSafeRedirectUrl(searchParams.get("redirect"));
            window.location.replace(redirect);
          })
          .catch((err: any) => {
            setError(err.message || "Google sign-in failed");
            setGoogleLoading(false);
          });
        return;
      }
    }

    if (getToken()) {
      router.replace("/");
    }
  }, [resetTokenParam, router, searchParams, showToast]);

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    try {
      const redirectTo = `${window.location.origin}/login`;
      const res = await api(`/auth/oauth/google/url?redirect_to=${encodeURIComponent(redirectTo)}`);
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      setError(err.message || "Google Sign-In is unavailable right now");
      setGoogleLoading(false);
    }
  }

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!isEmailValid || !password) return;
    setError(null);
    setSubmitting(true);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken();
      showToast("Signed in successfully", "success");
      const redirect = getSafeRedirectUrl(searchParams.get("redirect"));
      router.push(redirect);
    } catch (err: any) {
      setError(err.message || "Invalid email or password");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!isEmailValid) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSuccessMsg(res.message || "Password recovery link sent");
      if (res.dev_reset_token) {
        showToast("Dev reset token received", "info");
      }
    } catch (err: any) {
      setError(err.message || "Failed to process password recovery");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: resetTokenParam, new_password: newPassword }),
      });
      showToast("Password updated. Please sign in with your new password.", "success");
      setMode("login");
      setSuccessMsg("Password reset successfully. You can now log in.");
    } catch (err: any) {
      setError(err.message || "Failed to reset password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center py-8">
      {/* Centered Single Card */}
      <div className="rounded-lg border border-border bg-surface p-6 sm:p-8 shadow-xs">
        {mode === "login" && (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-text">Sign in</h1>
              <p className="mt-1 text-xs text-text-secondary">
                Enter your verified college email to access campus exchange
              </p>
            </div>

            {successMsg && (
              <div className="mb-4 rounded-md border border-primary/20 bg-primary-subtle p-3 text-xs text-primary">
                {successMsg}
              </div>
            )}

            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Input
                  label="College email address"
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@college.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-xs font-medium text-text">
                    Password <span className="text-danger">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 pr-10 text-base text-text placeholder:text-text-tertiary focus:border-primary focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-text-tertiary hover:text-text"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                    ) : (
                      <Eye className="h-4 w-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={!isEmailValid || !password || submitting || googleLoading}
                  loading={submitting}
                >
                  Sign in
                </Button>
              </div>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-border" />
                <span className="mx-3 shrink-0 text-[11px] uppercase tracking-wider text-text-tertiary">
                  or
                </span>
                <div className="flex-grow border-t border-border" />
              </div>

              <Button
                type="button"
                variant="secondary"
                className="w-full flex items-center justify-center gap-2"
                onClick={handleGoogleSignIn}
                loading={googleLoading}
                disabled={googleLoading || submitting}
              >
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                <span>Continue with Google</span>
              </Button>
            </form>

            <div className="mt-6 border-t border-border pt-4 text-center">
              <p className="text-xs text-text-secondary">
                New to ProductXchange?{" "}
                <Link href="/register" className="font-medium text-primary hover:underline">
                  Create an account
                </Link>
              </p>
            </div>
          </>
        )}

        {mode === "forgot" && (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-text">Reset password</h1>
              <p className="mt-1 text-xs text-text-secondary">
                Enter your registered college email and we will send a recovery link
              </p>
            </div>

            {successMsg ? (
              <div className="space-y-4 text-xs">
                <div className="rounded-md border border-primary/20 bg-primary-subtle p-3 text-primary">
                  {successMsg}
                </div>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setMode("login")}
                >
                  Return to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
                    <span>{error}</span>
                  </div>
                )}

                <Input
                  label="Registered college email"
                  type="email"
                  required
                  placeholder="name@college.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={!isEmailValid || submitting}
                  loading={submitting}
                >
                  Send recovery link
                </Button>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError(null);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span>Back to sign in</span>
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {mode === "reset" && (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-text">Set new password</h1>
              <p className="mt-1 text-xs text-text-secondary">
                Enter a secure password for your account
              </p>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
                  <span>{error}</span>
                </div>
              )}

              <Input
                label="New password (minimum 8 characters)"
                type="password"
                required
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={newPassword.length < 8 || submitting}
                loading={submitting}
              >
                Update password
              </Button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-xs font-medium text-text-secondary hover:text-text"
                >
                  Back to sign in
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md py-16 text-center text-xs text-text-secondary">
          Loading sign in...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
