import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-gold shadow-gold mb-4">
            <span className="text-2xl font-bold text-white">A</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Ariete Invest</h1>
          <p className="text-muted-foreground text-sm mt-1">Investor Portal — Restricted access</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-8 shadow-card">
          <LoginForm />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          © {new Date().getFullYear()} Ariete Invest. All rights reserved.
        </p>
      </div>
    </main>
  );
}
