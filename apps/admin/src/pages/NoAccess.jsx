export default function NoAccess() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center text-slate-100">
      <div className="text-3xl">🔒</div>
      <h1 className="text-lg font-semibold">У вас поки немає доступу до жодного магазину</h1>
      <p className="max-w-sm text-sm text-slate-500">Зверніться до адміністратора, щоб вам надали доступ у панелі SSO.</p>
    </div>
  );
}
