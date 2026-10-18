// Спільні поля форм замовлення (2026-10-18, правки Олексія): «Оплата» (часткова/повна передплата, накладений платіж)
// і «Постачальник» позиції. Використовують «Нове замовлення (вручну)» і редагування замовлення — щоб правила були однакові.
// Ті самі правила на сервері: apps/api/src/lib/orderOps.js (paymentFields).
import { Field, Input, Select, money } from '../common/Common';

export const PAYMENT_TYPE_LABEL = { partial: 'Часткова передплата', full: 'Повна передплата', cod: 'Накладений платіж без передплати' };
export const DEFAULT_PREPAYMENT = 200;

/** Передплата за способом оплати: повна = сума замовлення, накладений платіж = 0. */
export function prepaymentFor(payment, total) {
  if (payment.type === 'full') return total;
  if (payment.type === 'cod') return 0;
  if (payment.type === 'partial') return Number(payment.amount) || 0;
  return null;
}

/** Тіло запиту до API: {paymentType, prepaymentAmount} (порожній спосіб → не вказано). */
export function paymentPayload(payment) {
  if (!payment.type) return { paymentType: null };
  return { paymentType: payment.type, ...(payment.type === 'partial' ? { prepaymentAmount: Number(payment.amount) || DEFAULT_PREPAYMENT } : {}) };
}

/** Початковий стан форми з замовлення (або дефолт для нового). */
export function paymentFromOrder(order) {
  if (!order || !order.paymentType) return { type: order ? '' : 'partial', amount: String(DEFAULT_PREPAYMENT) };
  return { type: order.paymentType, amount: order.paymentType === 'partial' && order.prepaymentAmount != null ? String(Number(order.prepaymentAmount)) : String(DEFAULT_PREPAYMENT) };
}

/** Перевірка перед збереженням — текст помилки або ''. */
export function paymentError(payment, total) {
  if (payment.type !== 'partial') return '';
  const a = Number(payment.amount);
  if (!Number.isFinite(a) || a <= 0) return 'Вкажіть суму передплати';
  if (total > 0 && a > total) return 'Передплата більша за суму замовлення — оберіть «Повна передплата»';
  return '';
}

export function PaymentFields({ value, onChange, total, allowEmpty = false }) {
  const prepay = prepaymentFor(value, total);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label="Оплата">
        <Select value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value })}>
          {allowEmpty && <option value="">— не вказано —</option>}
          {Object.entries(PAYMENT_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
      </Field>
      {value.type === 'partial' && (
        <Field label="Сума передплати, грн">
          <Input type="number" min="1" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
        </Field>
      )}
      {value.type && (
        <div className="mb-3 self-end pb-2 text-sm text-slate-300">
          Разом {money(total)}
          {value.type !== 'cod' && <> · передплата <b>{money(prepay)}</b></>}
          <div>Решта при отриманні: <b>{money(Math.max(0, total - (prepay || 0)))}</b></div>
        </div>
      )}
    </div>
  );
}

/** Постачальник позиції: список постачальників магазину; підказка — постачальник товару з каталогу. */
export function SupplierSelect({ suppliers, value, onChange, catalogSupplierId }) {
  return (
    <Select value={value || ''} title="Постачальник" onChange={(e) => onChange(e.target.value)}>
      <option value="">— постачальник —</option>
      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{catalogSupplierId && s.id === catalogSupplierId ? ' (з каталогу)' : ''}</option>)}
    </Select>
  );
}
