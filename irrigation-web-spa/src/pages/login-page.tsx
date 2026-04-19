import { Droplets } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginShowcase">
        <div className="loginBrandRow">
          <div className="loginBrandSeal" aria-hidden>
            <Droplets size={24} strokeWidth={2.25} />
          </div>
          <h2>灌溉中心</h2>
        </div>
      </section>
      <LoginForm />
    </main>
  );
}
