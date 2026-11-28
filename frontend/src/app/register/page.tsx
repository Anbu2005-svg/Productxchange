"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, setToken, getToken } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Mail } from "lucide-react";

function getPasswordStrength(pw: string): { label: string; width: string; level: number } {
  if (pw.length === 0) return { label: "", width: "0%", level: 0 };
  if (pw.length < 6) return { label: "Too short", width: "25%", level: 1 };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: "Weak", width: "40%", level: 1 };
  if (score === 2) return { label: "Moderate", width: "65%", level: 2 };
  return { label: "Strong", width: "100%", level: 3 };
}

function GoogleIcon() {
  return (
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
  );
}

const PENDING_SIGNUP_KEY = "px_pending_signup";

export default function RegisterPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [form, setForm] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    full_name: "",
    college: "",
  });
  const [step, setStep] = useState<"email" | "sent" | "complete">("email");
  const [supabaseAccessToken, setSupabaseAccessToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function completeRegistration(
    payload: { email: string; password: string; full_name: string; college?: string | null },
    accessToken: string
  ) {
    await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
        full_name: payload.full_name,
        college: payload.college || null,
        supabase_access_token: accessToken,
      }),
    });
    try {
      sessionStorage.removeItem(PENDING_SIGNUP_KEY);
    } catch {}
    setToken();
    showToast("Account created successfully", "success");

    navigator.geolocation?.getCurrentPosition(
      async (pos) => {
        try {
          await api("/auth/me/location", {
            method: "PATCH",
            body: JSON.stringify({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          });
        } catch {}
        window.location.replace("/");
      },
      () => window.location.replace("/")
    );
  }

  useEffect(() => {
    if (getToken()) {
      router.replace("/");
      return;
    }

    if (typeof window !== "undefined" && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get("access_token");
      const hashError = hashParams.get("error_description") || hashParams.get("error");
      if (hashError) {
        setError(hashError);
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }
      if (accessToken) {
        window.history.replaceState(null, "", window.location.pathname);
        setVerifyingToken(true);
        api("/auth/supabase/verify-email-token", {
          method: "POST",
          body: JSON.stringify({ supabase_access_token: accessToken }),
        })
          .then(async (res) => {
            const verifiedEmail = (res.email || "").trim().toLowerCase();
            let pending: { email?: string; password?: string; full_name?: string; college?: string } | null = null;
            try {
              const raw = sessionStorage.getItem(PENDING_SIGNUP_KEY);
              if (raw) pending = JSON.parse(raw);
            } catch {}

            if (
              pending &&
              pending.email?.trim().toLowerCase() === verifiedEmail &&
              pending.password &&
              pending.full_name
            ) {
              try {
                await completeRegistration(
                  {
                    email: verifiedEmail,
                    password: pending.password,
                    full_name: pending.full_name,
                    college: pending.college,
                  },
                  accessToken
                );
                return;
              } catch (err: any) {
                setError(err.message || "Registration failed");
              }
            }

            setSupabaseAccessToken(accessToken);
            setForm((prev) => ({
              ...prev,
              email: verifiedEmail || prev.email,
              full_name: prev.full_name || pending?.full_name || res.full_name || "",
              college: prev.college || pending?.college || "",
            }));
            setStep("complete");
            showToast("Email verified! Confirm your details to finish.", "success");
          })
          .catch((err: any) => {
            setError(err.message || "Verification link expired or invalid. Please request a new one.");
            setStep("email");
          })
          .finally(() => setVerifyingToken(false));
      }
    }
  }, [router, showToast]);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const isNameValid = form.full_name.trim().length >= 2;
  const isPasswordValid = form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /[0-9]/.test(form.password);
  const doPasswordsMatch = form.password === form.confirmPassword;
  const strength = getPasswordStrength(form.password);

  const isDetailsValid = isEmailValid && isNameValid && isPasswordValid && doPasswordsMatch;
  const isFormValid = isDetailsValid && Boolean(supabaseAccessToken);

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

  async function handleSendVerificationLink(e: React.FormEvent) {
    e.preventDefault();
    if (!isDetailsValid) return;
    setSubmitting(true);
    setError(null);
    try {
      try {
        sessionStorage.setItem(
          PENDING_SIGNUP_KEY,
          JSON.stringify({
            email: form.email.trim().toLowerCase(),
            full_name: form.full_name.trim(),
            password: form.password,
            college: form.college.trim() || null,
          })
        );
      } catch {}
      await api("/auth/register/send-link", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          redirect_to: `${window.location.origin}/register`,
        }),
      });
      setStep("sent");
      showToast("Verification link sent to your email", "success");
    } catch (err: any) {
      setError(err.message || "Failed to send verification link");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid || !supabaseAccessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeRegistration(
        {
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          college: form.college || null,
        },
        supabaseAccessToken
      );
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  function renderAccountDetailsFields(includeEmail: boolean) {
    return (
      <>
        <div>
          <Input
            label="Full name"
            id="reg-name"
            required
            placeholder="e.g. Aditi Sharma"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            error={
              form.full_name && !isNameValid
                ? "Name must be at least 2 characters"
                : undefined
            }
          />
        </div>

        {includeEmail && (
          <div>
            <Input
              label="Email address"
              id="reg-email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@college.edu or you@gmail.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              helperText="We will send a verification link to this email"
              error={
                form.email && !isEmailValid
                  ? "Please enter a valid email address"
                  : undefined
              }
            />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="reg-password" className="block text-xs font-medium text-text">
              Password <span className="text-danger">*</span>
            </label>
            {strength.label && (
              <span className="font-mono text-[11px] text-text-tertiary">
                {strength.label}
              </span>
            )}
          </div>
          <div className="relative">
            <input
              id="reg-password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              placeholder="At least 8 characters (letters & numbers)"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
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

          {form.password.length > 0 && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
              <div
                style={{ width: strength.width }}
                className={`h-full transition-all duration-200 ${
                  strength.level === 3
                    ? "bg-success"
                    : strength.level === 2
                    ? "bg-warning"
                    : "bg-danger"
                }`}
              />
            </div>
          )}
        </div>

        <div>
          <label htmlFor="reg-confirm" className="block text-xs font-medium text-text mb-1.5">
            Confirm password <span className="text-danger">*</span>
          </label>
          <input
            id="reg-confirm"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            className={`w-full rounded-md border bg-surface px-3 py-2 text-base text-text placeholder:text-text-tertiary focus:outline-hidden ${
              form.confirmPassword && !doPasswordsMatch
                ? "border-danger focus:border-danger"
                : "border-border focus:border-primary"
            }`}
          />
          {form.confirmPassword && !doPasswordsMatch && (
            <p className="mt-1 text-xs text-danger">Passwords do not match</p>
          )}
        </div>

        <div>
          <Input
            label="College or campus name (optional)"
            id="reg-college"
            placeholder="e.g. IIT Madras, VIT, NIT"
            value={form.college}
            onChange={(e) => setForm({ ...form, college: e.target.value })}
          />
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center py-8">
      <div className="rounded-lg border border-border bg-surface p-6 sm:p-8 shadow-xs">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text">Create account</h1>
          <p className="mt-1 text-xs text-text-secondary">
            Enter your details and verify your email, or sign up with Google
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        {verifyingToken ? (
          <div className="py-8 text-center text-xs text-text-secondary">
            Verifying your email link...
          </div>
        ) : step === "email" ? (
          <div className="space-y-4">
            <form onSubmit={handleSendVerificationLink} className="space-y-4">
              {renderAccountDetailsFields(true)}
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={!isDetailsValid || submitting || googleLoading}
                loading={submitting}
              >
                Send verification link
              </Button>
            </form>

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
              <GoogleIcon />
              <span>Continue with Google</span>
            </Button>
          </div>
        ) : step === "sent" ? (
          <div className="space-y-4 text-center py-2">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-subtle text-primary">
              <Mail className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">Check your inbox</h2>
              <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                We sent a verification link to{" "}
                <span className="font-medium text-text">{form.email}</span>. Click the link in that email to finish creating your account.
              </p>
            </div>
            <div className="flex items-center justify-center gap-4 pt-2 text-xs text-text-secondary">
              <button
                type="button"
                onClick={() => { setStep("email"); setError(null); }}
                className="hover:text-text hover:underline"
              >
                Edit details
              </button>
              <button
                type="button"
                onClick={handleSendVerificationLink}
                disabled={submitting}
                className="font-medium text-primary hover:underline"
              >
                Resend link
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary-subtle px-3 py-2 text-xs text-primary">
              <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="truncate">Verified: {form.email}</span>
            </div>

            {renderAccountDetailsFields(false)}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={!isFormValid || submitting}
                loading={submitting}
              >
                Create account
              </Button>
            </div>
          </form>
        )}

        <div className="mt-6 border-t border-border pt-4 text-center">
          <p className="text-xs text-text-secondary">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
