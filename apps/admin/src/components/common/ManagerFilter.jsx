// Фільтр «Менеджер» (хто оформив замовлення) для звітів — Edits 1a01e6dd, 06.11: менеджери хочуть бачити свої цифри за день.
// Список імен — з GET /analytics/placed-by (Order.placedBy). Порожнє значення = усі менеджери. Реклама й постійні витрати по менеджерах не діляться.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Select } from './Common';

export default function ManagerFilter({ value, onChange }) {
  const [names, setNames] = useState([]);
  useEffect(() => { api.analyticsPlacedBy().then((r) => setNames(r.data || [])).catch(() => {}); }, []);
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-400">
      Менеджер
      <Select className="!w-auto !py-1.5 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">усі</option>
        {names.map((n) => <option key={n.name} value={n.name}>{n.name} ({n.orders})</option>)}
      </Select>
    </label>
  );
}
