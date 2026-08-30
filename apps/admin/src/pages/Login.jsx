// §9.1 Вхід (SSO) — заглушка з логотипом і кнопкою, без власної форми логіну.
export default function Login() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 text-slate-100">
      <div className="text-4xl">🧾</div>
      <h1 className="text-xl font-semibold">Fineko CRM</h1>
      <a href="/auth/sso/login" className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
        Увійти через FINEKO ID
      </a>
    </div>
  );
}
