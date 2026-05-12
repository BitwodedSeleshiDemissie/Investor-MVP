import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, hsl(222 47% 6%) 0%, hsl(222 47% 12%) 100%)" }}
    >
      <section className="w-full max-w-md rounded-xl border border-border bg-card text-card-foreground shadow-card">
        <div className="text-center space-y-4 p-6">
          <div className="flex justify-center">
            <img
              src="/ariete-logo.png"
              alt="Ariete Capital"
              className="h-16 w-auto"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Investor Portal</h1>
            <p className="text-sm text-muted-foreground">Login</p>
          </div>
        </div>
        <div className="p-6 pt-0">
          <LoginForm />
          <p className="text-center text-xs text-muted-foreground mt-6">
            Access by invitation only
          </p>
        </div>
      </section>
    </main>
  );
}
