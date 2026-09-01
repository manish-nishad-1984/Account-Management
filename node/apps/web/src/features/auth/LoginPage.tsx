import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, KeyRound, Lock, ShieldCheck, TrendingUp, User } from "lucide-react";
import { loginRequestSchema, type LoginRequest } from "@accountmanagement/contracts";
import { useAuth } from "../../contexts/AuthContext";
import { ApiError } from "../../lib/api-client";
import { Alert, Button, TextField } from "../../components/ui";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { userName: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not reach the server");
    }
  });

  return (
    <div className="flex min-h-full">
      {/* Brand panel — hidden on small screens, where the form is all that matters. */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-shell-950 p-12 lg:flex">
        <div
          aria-hidden
          className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-600/20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-16 size-96 rounded-full bg-brand-500/10 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-lg">
            AB
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Account Book</div>
            <div className="text-[11px] text-slate-400">D H Infra</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-white">
            Procurement and accounting, end to end.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Purchase requests through to payment, across every site and company —
            in one ledger.
          </p>

          <ul className="mt-10 space-y-4">
            {[
              { icon: ShieldCheck, text: "Permissions enforced on every request" },
              { icon: Lock, text: "Credentials hashed with argon2id" },
              { icon: TrendingUp, text: "Server-paginated, whatever the volume" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-inset ring-white/10">
                  <Icon aria-hidden className="size-4 text-brand-300" />
                </div>
                <span className="text-sm text-slate-300">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-600">
          &copy; {new Date().getFullYear()} D H Infra
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-white px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
              AB
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">Account Book</div>
              <div className="text-[11px] text-slate-500">D H Infra</div>
            </div>
          </div>

          <div className="mb-7">
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-inset ring-brand-100">
              <KeyRound aria-hidden className="size-5 text-brand-600" />
            </div>
            <h1 className="heading text-2xl">Sign in</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Enter your Account Book credentials to continue.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {error && <Alert icon={AlertCircle}>{error}</Alert>}

            <TextField
              label="Username"
              placeholder="your.username"
              autoComplete="username"
              autoFocus
              icon={User}
              error={errors.userName?.message}
              {...register("userName")}
            />
            <TextField
              label="Password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              icon={Lock}
              error={errors.password?.message}
              {...register("password")}
            />

            <Button type="submit" loading={isSubmitting} className="w-full py-2.5">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-8 border-t border-slate-100 pt-5 text-xs leading-relaxed text-slate-400">
            Sessions are held in memory only, never in browser storage — so
            refreshing the page signs you out.
          </p>
        </div>
      </div>
    </div>
  );
}
