// §9.11 Повернення/обміни — список + форма.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Select, Field, Textarea, Card, EmptyState, ErrorBanner, Badge } from '../components/common/Common';
import Modal from '../components/common/Modal';

const STATUS_COLOR = { new: 'amber', confirmed: 'teal', completed: 'green' };
const STATUS_LABEL = { new: 'нове', confirmed: 'підтверджено', completed: 'завершено' };
const TYPE_LABEL = { return: 'повернення', exchange: 'обмін' };

export default function ReturnsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setError('');
    try { setItems((await api.listReturns()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function updateStatus(id, status) {
    try { await api.updateReturn(id, { status }); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Повернення/обміни" action={<Button onClick={() => setCreating(true)}>+ Повернення</Button>} />
      <ErrorBanner message={error} />
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Повернень ще немає" action={<Button onClick={() => setCreating(true)}>+ Повернення</Button>} />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Замовлення</th><th className="px-4 py-3">Покупець</th><th className="px-4 py-3">Тип</th><th className="px-4 py-3">Причина</th><th className="px-4 py-3">Статус</th></tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-slate-400">{new Date(r.createdAt).toLocaleDateString('uk-UA')}</td>
                  <td className="px-4 py-3">#{r.orderId.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-slate-400">{r.order?.buyer?.fullName || r.order?.buyer?.phone || '—'}</td>
                  <td className="px-4 py-3">{TYPE_LABEL[r.type]}</td>
                  <td className="px-4 py-3 text-slate-400">{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <Select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)} className="!w-auto py-1">
                      {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Modal isOpen={creating} title="Нове повернення" onClose={() => setCreating(false)}>
        <ReturnForm onCancel={() => setCreating(false)} onSave={async (data) => { await api.createReturn(data); setCreating(false); load(); }} />
      </Modal>
    </div>
  );
}

export function ReturnForm({ orderId: initialOrderId, onSave, onCancel }) {
  const [orderId, setOrderId] = useState(initialOrderId || '');
  const [type, setType] = useState('return');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      if (!orderId.trim()) throw new Error('orderId обовʼязковий');
      await onSave({ orderId: orderId.trim(), type, reason });
    } catch (e) { setError(e.message); }
  }

  return (
    <form onSubmit={submit}>
      <ErrorBanner message={error} />
      {!initialOrderId && <Field label="ID замовлення"><input className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" value={orderId} onChange={(e) => setOrderId(e.target.value)} /></Field>}
      <Field label="Тип">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="return">Повернення</option>
          <option value="exchange">Обмін</option>
        </Select>
      </Field>
      <Field label="Причина"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
