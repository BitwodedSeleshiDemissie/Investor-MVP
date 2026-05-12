import Image from "next/image";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card text-card-foreground shadow-card">
        <div className="text-center space-y-4 p-6">
          <div className="flex justify-center">
            <Image
              src="/ariete-logo.png"
              alt="Ariete Capital"
              width={220}
              height={64}
              priority
              className="h-16 w-auto"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ariete Investor Portal</h1>
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
