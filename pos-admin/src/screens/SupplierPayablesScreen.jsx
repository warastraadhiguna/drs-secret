import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import { rupiah, shortDate, dateTime, todayStr, PAYMENT_STATUS_LABEL, paymentBadgeStyle } from '../utils/format.js';

const METHODS = [
  { value: 'bank', label: 'Bank (transfer)' },
  { value: 'cash', label: 'Kas (tunai)' },
  { value: 'return_credit', label: 'Potong saldo retur' },
];

// Utang ke supplier dari pembelian KREDIT + pelunasannya (per nota, boleh
// dicicil). Data & aturan di server (SupplierPayableService).
export default function SupplierPayablesScreen() {
  const [summary, setSummary] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  function reload() {
    api.getSupplierPayablesSummary().then(setSummary).catch((err) => setError(err.message));
    api.listPayablePurchases({ supplierId: supplierId || undefined, status: showAll ? 'all' : 'outstanding' })
      .then((d) => setPurchases(d.purchases))
      .catch((err) => setError(err.message));
  }
  useEffect(reload, [supplierId, showAll]);

  if (selectedId) {
    return (
      <PayableDetail
        purchaseId={selectedId}
        onBack={() => { setSelectedId(null); reload(); }}
      />
    );
  }

  return (
    <div>
      <h2>Utang Supplier</h2>
      <p style={{ color: '#666', marginTop: -8 }}>Pembelian kredit yang belum lunas. Klik nota untuk mencatat pelunasan.</p>
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <Banner type="success" message={info} onClose={() => setInfo(null)} />

      {summary && (
        <div className="summary-tiles">
          <div className="summary-tile">
            <div className="label">Total utang (nota belum lunas)</div>
            <div className="value" style={{ color: Number(summary.totalOutstanding) > 0 ? '#b91c1c' : undefined }}>{rupiah(summary.totalOutstanding)}</div>
          </div>
          <div className="summary-tile">
            <div className="label">Saldo retur kredit (belum dipakai)</div>
            <div className="value">{rupiah(summary.totalReturnCredit)}</div>
          </div>
          <div className="summary-tile">
            <div className="label">Utang bersih</div>
            <div className="value">{rupiah(summary.totalNet)}</div>
          </div>
        </div>
      )}

      {summary && summary.suppliers.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Per supplier</h3>
          <table>
            <thead>
              <tr>
                <th>Supplier</th><th style={{ textAlign: 'right' }}>Nota terbuka</th>
                <th style={{ textAlign: 'right' }}>Utang</th><th style={{ textAlign: 'right' }}>Saldo retur</th>
                <th style={{ textAlign: 'right' }}>Bersih</th><th>Jatuh tempo terdekat</th>
              </tr>
            </thead>
            <tbody>
              {summary.suppliers.map((s) => (
                <tr
                  key={s.supplierId}
                  className="clickable"
                  onClick={() => setSupplierId(supplierId === s.supplierId ? '' : s.supplierId)}
                  style={supplierId === s.supplierId ? { background: '#eef2ff' } : undefined}
                >
                  <td>{s.supplierName}</td>
                  <td style={{ textAlign: 'right' }}>{s.openCount}</td>
                  <td style={{ textAlign: 'right' }}>{rupiah(s.outstanding)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(s.returnCredit) > 0 ? rupiah(s.returnCredit) : '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupiah(s.net)}</td>
                  <td>{s.nearestDue ? shortDate(s.nearestDue) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 0 }}>Klik supplier untuk menyaring daftar nota di bawah.</p>
        </div>
      )}

      <div className="inline-form">
        <strong>Nota pembelian kredit{supplierId && summary ? ` — ${summary.suppliers.find((s) => s.supplierId === supplierId)?.supplierName || ''}` : ''}</strong>
        {supplierId && <button className="btn-secondary" onClick={() => setSupplierId('')}>Semua supplier</button>}
        <label style={{ fontSize: 13, marginLeft: 'auto' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Tampilkan yang sudah lunas
        </label>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>No. Nota</th><th>Tanggal</th><th>Supplier</th><th>Jatuh tempo</th>
              <th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Dibayar</th>
              <th style={{ textAlign: 'right' }}>Sisa</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setSelectedId(p.id)}>
                <td>{p.purchaseNumber}</td>
                <td>{shortDate(p.purchaseDate)}</td>
                <td>{p.supplierName}</td>
                <td style={p.overdue ? { color: '#b91c1c', fontWeight: 600 } : undefined}>
                  {p.dueDate ? shortDate(p.dueDate) : '-'}{p.overdue ? ' (lewat)' : ''}
                </td>
                <td style={{ textAlign: 'right' }}>{rupiah(p.grandTotal)}</td>
                <td style={{ textAlign: 'right' }}>{rupiah(p.amountPaid)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(p.outstanding) > 0 ? rupiah(p.outstanding) : '-'}</td>
                <td><span className="status-pill" style={paymentBadgeStyle(p.paymentStatus)}>{PAYMENT_STATUS_LABEL[p.paymentStatus]}</span></td>
              </tr>
            ))}
            {purchases.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: '#999', padding: 20 }}>Tidak ada utang — semua pembelian kredit sudah lunas</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayableDetail({ purchaseId, onBack }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ method: 'bank', amount: '', paymentDate: todayStr(), notes: '' });
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  function apply(p) {
    setData(p);
    setForm((f) => ({ ...f, amount: p.outstanding }));
  }
  useEffect(() => {
    api.getPurchasePayable(purchaseId).then((d) => apply(d.purchase)).catch((err) => setError(err.message));
  }, [purchaseId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api.recordSupplierPayment(purchaseId, {
        method: form.method,
        amount: Number(form.amount),
        paymentDate: form.paymentDate,
        notes: form.notes || undefined,
      });
      apply(d.purchase);
      setForm((f) => ({ ...f, notes: '' }));
      setError(null);
      setInfo('Pelunasan dicatat');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function voidPay(p) {
    const reason = window.prompt(`Batalkan pelunasan ${rupiah(p.amount)} (${p.methodLabel})?\nTulis alasannya:`);
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const d = await api.voidSupplierPayment(p.id, reason.trim());
      apply(d.purchase);
      setInfo('Pelunasan dibatalkan');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div>
        <button className="btn-secondary" onClick={onBack}>‹ Kembali</button>
        <Banner type="error" message={error} onClose={() => setError(null)} />
      </div>
    );
  }

  const canPay = data.status === 'completed' && data.paymentType === 'credit' && Number(data.outstanding) > 0;

  return (
    <div>
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: 12 }}>‹ Kembali</button>
      <h2 style={{ marginTop: 0 }}>
        {data.purchaseNumber}{' '}
        <span className="status-pill" style={paymentBadgeStyle(data.paymentStatus)}>{PAYMENT_STATUS_LABEL[data.paymentStatus]}</span>
      </h2>
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <Banner type="success" message={info} onClose={() => setInfo(null)} />

      <div className="summary-tiles">
        <div className="summary-tile"><div className="label">Supplier</div><div className="value" style={{ fontSize: 16 }}>{data.supplierName}</div><div style={{ fontSize: 12, color: '#666' }}>Tgl {shortDate(data.purchaseDate)}{data.dueDate ? ` · jatuh tempo ${shortDate(data.dueDate)}` : ''}</div></div>
        <div className="summary-tile"><div className="label">Total nota</div><div className="value">{rupiah(data.grandTotal)}</div></div>
        <div className="summary-tile"><div className="label">Sudah dibayar</div><div className="value">{rupiah(data.amountPaid)}</div></div>
        <div className="summary-tile"><div className="label">Sisa utang</div><div className="value" style={{ color: Number(data.outstanding) > 0 ? '#b91c1c' : undefined }}>{rupiah(data.outstanding)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Riwayat pelunasan</h3>
          <table>
            <thead><tr><th>Tanggal</th><th>Cara</th><th style={{ textAlign: 'right' }}>Jumlah</th><th></th></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} style={p.status === 'voided' ? { color: '#999' } : undefined}>
                  <td>
                    {shortDate(p.paymentDate)}
                    {p.notes && <div style={{ fontSize: 12, color: '#666' }}>{p.notes}</div>}
                    <div style={{ fontSize: 11, color: '#999' }}>{p.createdByName} · {dateTime(p.createdAt)}</div>
                  </td>
                  <td>{p.methodLabel}</td>
                  <td style={{ textAlign: 'right', textDecoration: p.status === 'voided' ? 'line-through' : undefined }}>{rupiah(p.amount)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {p.status === 'voided'
                      ? <span style={{ fontSize: 12 }} title={p.voidReason || ''}>dibatalkan</span>
                      : <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => voidPay(p)} disabled={busy}>Batalkan</button>}
                  </td>
                </tr>
              ))}
              {data.payments.length === 0 && <tr><td colSpan={4} style={{ color: '#999', textAlign: 'center' }}>Belum ada pelunasan</td></tr>}
            </tbody>
          </table>
        </div>

        {canPay && (
          <form className="card" onSubmit={submit}>
            <h3 style={{ marginTop: 0 }}>Catat pelunasan</h3>
            <div className="form-grid">
              <div>
                <label>Cara bayar</label>
                <select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value} disabled={m.value === 'return_credit' && Number(data.returnCreditAvailable) <= 0}>
                      {m.label}{m.value === 'return_credit' ? ` (saldo ${rupiah(data.returnCreditAvailable)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div><label>Jumlah</label><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></div>
              <div><label>Tanggal</label><input className="input" type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} /></div>
              <div><label>Catatan</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="opsional" /></div>
            </div>
            {form.method === 'return_credit' && (
              <p style={{ fontSize: 12, color: '#666' }}>Memakai saldo retur kredit ke supplier ini — tidak ada uang keluar.</p>
            )}
            <button className="btn-primary" type="submit" style={{ marginTop: 12 }} disabled={busy || !Number(form.amount)}>Simpan pelunasan</button>
          </form>
        )}
      </div>
    </div>
  );
}
