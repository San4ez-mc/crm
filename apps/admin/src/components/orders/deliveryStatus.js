// Статус посилки (2026-10-26, Edits 47935e18/2fab64c4) — та сама логіка, що apps/api/src/lib/deliveryStatus.js (сервер віддає
// status у звітах реклами; тут — для картки замовлення, де є ttnStatus/isRefused/returns/stage).
export const DELIVERY = {
  awaiting: { label: 'Очікує на відправку', color: 'slate' },
  in_transit: { label: 'Посилка в дорозі', color: 'sky' },
  at_post: { label: 'На пошті', color: 'orange' },
  refused: { label: 'Відмова від отримання', color: 'red' },
  returned: { label: 'Повернення', color: 'amber' },
  picked_up: { label: 'Забрано', color: 'green' },
};

export function deliveryStatusOf(o) {
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
