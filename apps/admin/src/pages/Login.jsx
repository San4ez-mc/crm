// §9.1 Вхід (SSO) — та сама структура, що на сторінках входу інших продуктів
// FINEKO (напр. flows.fineko.space/login): фонове зображення з затемненням,
// скляна картка з лого + назвою, ОДНА кнопка "Увійти через FINEKO" — без
// власної форми логіну/пароля, бо CRM автентифікує лише через SSO.
const SSO_MESSAGES = {
    denied: 'Цей акаунт не має доступу до CRM. Зверніться до адміністратора.',
    state: 'Сесія входу застаріла. Спробуйте ще раз.',
    exchange: 'Не вдалося завершити вхід через SSO. Спробуйте ще раз.',
    error: 'Помилка входу через SSO. Спробуйте ще раз.',
};

export default function Login() {
    const ssoError = new URLSearchParams(window.location.search).get('sso');

    const bgStyle = {
        background:
            "linear-gradient(rgba(2,6,23,.55), rgba(2,6,23,.88)), url('/login-bg.png') center/cover fixed, #020617",
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={bgStyle}>
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
                        <span className="text-3xl">🧾</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Fineko CRM</h1>
                    <p className="text-slate-300 mt-1">Єдиний вхід у продукти FINEKO</p>
                </div>

                <div className="bg-slate-900/80 backdrop-blur rounded-2xl p-6 border border-white/10 shadow-2xl space-y-4">
                    {ssoError && SSO_MESSAGES[ssoError] && (
                        <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                            {SSO_MESSAGES[ssoError]}
                        </div>
                    )}

                    <a
                        href="/auth/sso/login"
                        className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white rounded-lg py-3 font-medium transition-colors"
                    >
                        Увійти через FINEKO
                    </a>
                </div>
            </div>
        </div>
    );
}
