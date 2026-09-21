import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Clock, KeyRound, Lock, ShieldCheck, TrendingUp, User } from "lucide-react";
import { loginRequestSchema, type LoginRequest } from "@accountmanagement/contracts";
import { useAuth } from "../../contexts/AuthContext";
import { ApiError } from "../../lib/api-client";
import { Alert, Button, TextField } from "../../components/ui";

export function LoginPage() {
  const { login, endedReason } = useAuth();
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
      {/*
        Brand panel — hidden on small screens, where the form is all that matters.

        LIGHT, like the rest of the application. It was a near-black column with
        two blurred colour blobs behind it, which was the only place in the
        product that looked like this — and it broke outright when the dark
        `shell-*` ramp was retired with the sidebar: `bg-shell-950` stopped
        resolving, leaving white text on white. A light panel separated by one
        hairline says the same thing and cannot rot that way.
      */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-slate-200 bg-slate-50 p-12 lg:flex">
        {/* One wash of sky, very faint. Enough to stop the panel reading as
            empty; not enough to be a gradient anybody notices. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-100/50 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            AB
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">Account Book</div>
            <div className="text-xs text-slate-500">D H Infra</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="heading text-[28px] leading-tight">
            Procurement and accounting, end to end.
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Purchase requests through to payment, across every site and company —
            in one ledger.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { icon: ShieldCheck, text: "Permissions enforced on every request" },
              { icon: Lock, text: "Credentials hashed with argon2id" },
              { icon: TrendingUp, text: "Server-paginated, whatever the volume" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-md bg-white text-brand-600 ring-1 ring-inset ring-slate-200">
                  <Icon aria-hidden className="size-4" />
                </div>
                <span className="text-sm text-slate-600">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-400">
          &copy; {new Date().getFullYear()} D H Infra
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-white px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
              AB
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">Account Book</div>
              <div className="text-xs text-slate-500">D H Infra</div>
            </div>
          </div>

          <div className="mb-7">
            <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
              <KeyRound aria-hidden className="size-4" />
            </div>
            <h1 className="heading text-[22px] leading-7">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500">
              Enter your Account Book credentials to continue.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && <Alert icon={AlertCircle}>{error}</Alert>}
            {/*
              Why they are here, when they did not choose to be. Arriving at the
              login page mid-task with no word of explanation reads as a crash.
            */}
            {!error && endedReason === "idle" && (
              <Alert tone="info" icon={Clock}>
                You were signed out after 30 minutes without activity. Sign in to carry on.
              </Alert>
            )}
            {!error && endedReason === "expired" && (
              <Alert tone="info" icon={Clock}>
                Your session has ended. Sign in to carry on.
              </Alert>
            )}

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

            {/* 36px, like every other control. `loadingLabel` is the shared way
                to say what is happening - see the note on Button. */}
            <Button
              type="submit"
              loading={isSubmitting}
              loadingLabel="Signing in…"
              className="w-full"
            >
              Sign in
            </Button>
          </form>

          <p className="mt-8 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500">
            Sessions are held in memory only, never in browser storage — so
            refreshing the page signs you out.
          </p>
        </div>
      </div>
    </div>
  );
}
