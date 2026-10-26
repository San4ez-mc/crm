// Статус посилки замовлення для звітів (2026-10-26, Олексій, Edits 47935e18/2fab64c4): раніше в «Рекламних витратах» був лише
// «Забрано» (= не відмова), навіть коли посилка ще не відправлена. Тепер — за Новою поштою (ttnStatus, який CRM опитує сама,
// lib/novaPoshta.js), позначкою «Відмова» і поверненнями:
//   awaiting   — Очікує на відправку (ТТН нема або накладну лише створено)       сірий
//   in_transit — Посилка в дорозі                                               блакитний
//   at_post    — На пошті (прибула, клієнт ще не забрав)                         оранжевий
//   refused    — Відмова від отримання                                          червоний
//   returned   — Повернення (оформлене повернення/обмін)                         бурштиновий
//   picked_up  — Забрано                                                         зелений
// Текст статусу — дані Нової пошти (фіксовані формулювання API), не слова клієнта.

function deliveryStatus(o) {
  if (!o) return 'awaiting';
  if (o.isRefused) return 'refused';
  if (Array.isArray(o.returns) && o.returns.length) return 'returned';
  const st = String(o.ttnStatus || '').toLowerCase();
  const stage = String((o.stage && o.stage.name) || '').toLowerCase();
  if (/відмов/.test(st)) return 'refused';
  if ((/отриман|забрав|вручен/.test(st) && !/не\s+отрима|зворотн/.test(st)) || (/клієнт\s+забрав|^забрав|отрима/.test(stage) && !/не\s+забрав/.test(stage))) return 'picked_up';
  if (/прибув|у відділенн|в відділенн|у поштомат|в поштомат|очікує.*отримувач|зберіган/.test(st) || /не\s+забрав/.test(stage)) return 'at_post';
  const hasTtn = Array.isArray(o.ttn) ? o.ttn.length > 0 : !!o.ttn;
  if (!hasTtn || !st || /створив|ще не надав|не надійшл|видален|не знайден/.test(st)) return 'awaiting';
  return 'in_transit';
}

module.exports = { deliveryStatus };
