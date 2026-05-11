"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, LogIn } from "lucide-react";
import { loginAction } from "@/server/actions/auth";

const schema = z.object({
  password: z.string().min(1, "Please enter a password"),
  role: z.enum(["investor", "admin"]),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: "investor" },
  });

  const role = watch("role");

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const result = await loginAction(values);
    if (result?.data?.error) {
      setServerError(result.data.error);
      return;
    }
    if (result?.data?.success) {
      router.push(values.role === "admin" ? "/admin" : "/dashboard");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Role selector */}
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-2">Sign in as</p>
        <div className="grid grid-cols-2 gap-2">
          {(["investor", "admin"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setValue("role", r)}
              className={`py-2 px-4 rounded-lg text-sm font-medium transition-all border ${
                role === r
                  ? "bg-primary text-primary-foreground border-primary shadow-gold"
                  : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground hover:bg-secondary"
              }`}
            >
              {r === "investor" ? "Investor" : "Admin"}
            </button>
          ))}
        </div>
      </div>

      {/* Password */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            {...register("password")}
            type={showPw ? "text" : "password"}
            placeholder="••••••••••"
            autoComplete="current-password"
            suppressHydrationWarning
            className="w-full pl-10 pr-10 py-2.5 bg-secondary/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {errors.password && <p className="text-destructive text-xs mt-1">{errors.password.message}</p>}
      </div>

      {serverError && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {serverError}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-gold text-white font-semibold rounded-lg shadow-gold hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {isSubmitting ? (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <LogIn className="w-4 h-4" />
        )}
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
