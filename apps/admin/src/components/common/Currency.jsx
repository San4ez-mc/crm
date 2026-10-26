// Перемикач гривня/долар для звітів реклами (2026-10-26, Олексій, Edits 6194e8b9: «мені треба долар — хай він за замовчуванням»).
// Сервер рахує все в гривнях (витрати Meta в $ уже переведені за курсом магазину); тут лише показ: грн → $ за тим самим курсом
// (usdRate з відповіді API). Вибір запамʼятовується в браузері.
import { useState } from 'react';

const KEY = 'crm.currency';
function readCur() { try { return localStorage.getItem(KEY) === 'UAH' ? 'UAH' : 'USD'; } catch (e) { return 'USD'; } }

export function useCurrency() {
  const [cur, setCurState] = useState(readCur);
  const setCur = (c) => { setCurState(c); try { localStorage.setItem(KEY, c); } catch (e) { /* без памʼяті — лише цей перегляд */ } };
  return [cur, setCur];
}

/** Сума в гривнях → рядок у вибраній валюті. Курсу нема — показуємо гривні (чесніше, ніж вигаданий долар). */
export function fmtMoney(uah, cur, usdRate) {
  const n = Number(uah || 0);
  if (cur === 'USD' && Number(usdRate) > 0) return `$${(n / Number(usdRate)).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}`;
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;
}

export function CurrencyToggle({ cur, setCur, usdRate }) {
  const btn = (c, label) => (
    <button type="button" onClick={() => setCur(c)} className={`px-3 py-1.5 text-xs ${cur === c ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{label}</button>
  );
  return (
    <div className="inline-flex items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">{btn('UAH', '₴ Гривня')}{btn('USD', '$ Долар')}</div>
      {cur === 'USD' && Number(usdRate) > 0 && <span className="text-[11px] text-slate-500">курс {Number(usdRate).toFixed(2)}</span>}
    </div>
  );
}
