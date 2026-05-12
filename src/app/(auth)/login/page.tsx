import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, hsl(222 47% 6%) 0%, hsl(222 47% 12%) 100%)" }}
    >
      <section className="w-full max-w-[448px] rounded-xl border border-border bg-card text-card-foreground shadow-card">
        <div className="px-6 pb-6 pt-8 text-center">
          <div className="mb-5 flex h-16 items-center justify-center">
            <img
              src="/ariete-logo.png"
              alt="Ariete Capital"
              className="block h-16 w-auto max-w-[250px] object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold leading-tight text-foreground">Investor Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">Login</p>
        </div>
        <div className="px-6 pb-6 pt-0">
          <LoginForm />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Access by invitation only
          </p>
        </div>
      </section>
    </main>
  );
}
