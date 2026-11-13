"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, setToken, getToken } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

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

export default function RegisterPage() {
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    if (getToken()) {
      router.replace("/");
    }
  }, [router]);

  const [form, setForm] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    full_name: "",
    college: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const isNameValid = form.full_name.trim().length >= 2;
  const isPasswordValid = form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /[0-9]/.test(form.password);
  const doPasswordsMatch = form.password === form.confirmPassword;
  const strength = getPasswordStrength(form.password);

  const isFormValid = isEmailValid && isNameValid && isPasswordValid && doPasswordsMatch;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const { access_token } = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          college: form.college || null,
        }),
      });
      setToken(access_token);
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
          router.push("/");
        },
        () => router.push("/")
      );
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center py-8">
      {/* Centered Single Card */}
      <div className="rounded-lg border border-border bg-surface p-6 sm:p-8 shadow-xs">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text">Create account</h1>
          <p className="mt-1 text-xs text-text-secondary">
            Join the verified campus exchange for zero-fee peer trading
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div>
            <Input
              label="College email address"
              id="reg-email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@college.edu"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              helperText="Campus-verified email is recommended for trust badges"
              error={
                form.email && !isEmailValid
                  ? "Please enter a valid email address"
                  : undefined
              }
            />
          </div>

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
