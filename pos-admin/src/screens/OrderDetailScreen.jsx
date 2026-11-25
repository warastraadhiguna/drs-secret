import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import InvoiceDocument from '../components/InvoiceDocument.jsx';
import { downloadInvoicePdf } from '../utils/invoicePdf.js';
import {
  rupiah, qty, longDate, shortDate, dateTime, todayStr, isPickup, groupInvoiceLines, componentsText,
  PAYMENT_STATUS_LABEL, SHIPPING_STATUS_LABEL, paymentBadgeStyle, shippingBadgeStyle,
} from '../utils/format.js';

// Ringkasan teks utk ditempel ke chat WA pelanggan.
function buildWaText(order) {
  const s = order.invoiceSettings || {};
  const lines = [`*Invoice #${order.invoiceNumber}* — ${longDate(order.invoiceDate)}`, `Kepada: ${order.customerName}${order.customerCity ? ` (${order.customerCity})` : ''}`, ''];
  for (const it of groupInvoiceLines(order.items)) {
    const indentTag = it.isIndent ? ' (indent)' : '';
    lines.push(it.isBonus
      ? `• ${it.productName} × ${qty(it.quantity)}${indentTag} — FREE`
      : `• ${it.productName} × ${qty(it.quantity)}${indentTag} — ${rupiah(it.subtotal)}`);
    if (it.kind === 'bundle') lines.push(`   (isi: ${componentsText(it.components)})`);
  }
  lines.push('');
  if (Number(order.discountTotal) > 0) lines.push(`Diskon: -${rupiah(order.discountTotal)}`);
  if (Number(order.ppnAmount) > 0) lines.push(`PPN: ${rupiah(order.ppnAmount)}`);
  if (Number(order.shippingFee) > 0) lines.push(`Ongkir${order.shippingMethod ? ` (${order.shippingMethod})` : ''}: ${rupiah(order.shippingFee)}`);
  lines.push(`*Total: ${rupiah(order.totalDue)}*`);
  if (Number(order.amountPaid) > 0 && Number(order.outstanding) > 0) lines.push(`Sudah dibayar: ${rupiah(order.amountPaid)}`, `*Sisa: ${rupiah(order.outstanding)}*`);
  if (order.notes) lines.push('', order.notes);
  if (s.bankInfo && Number(order.outstanding) > 0) lines.push('', 'Transfer ke:', s.bankInfo);
  if (order.paymentStatus === 'paid') lines.push('', 'Status: LUNAS — terima kasih 🙏');
  if (order.trackingNumber) lines.push(`Resi ${order.shippingMethod || ''}: ${order.trackingNumber}`.trim());
  return lines.join('\n');
}

export default function OrderDetailScreen({ orderId, onBack, onOpenCustomer }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [shippingMethods, setShippingMethods] = useState([]);
  const [payForm, setPayForm] = useState({ paymentMethodId: '', amount: '', paymentDate: todayStr(), notes: '' });
  const [shipForm, setShipForm] = useState({ shippingMethod: '', trackingNumber: '', shippingAddress: '' });
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  function applyOrder(o) {
    setOrder(o);
    setPayForm((p) => ({ ...p, amount: o.outstanding }));
    setShipForm({ shippingMethod: o.shippingMethod || '', trackingNumber: o.trackingNumber || '', shippingAddress: o.shippingAddress || '' });
  }

  useEffect(() => {
    api.getOrder(orderId).then((d) => applyOrder(d.order)).catch((err) => setError(err.message));
    api.listActivePaymentMethods().then((d) => {
      setPaymentMethods(d.methods);
      if (d.methods[0]) setPayForm((p) => ({ ...p, paymentMethodId: p.paymentMethodId || d.methods[0].id }));
    }).catch(() => {});
    api.listShippingMethods().then((d) => setShippingMethods(d.methods)).catch(() => {});
  }, [orderId]);

  async function run(fn, successMsg) {
    setBusy(true);
    try {
      const d = await fn();
      applyOrder(d.order);
      setError(null);
      if (successMsg) setInfo(successMsg);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function addPayment(e) {
    e.preventDefault();
    run(() => api.recordOrderPayment(orderId, {
      paymentMethodId: payForm.paymentMethodId,
      amount: Number(payForm.amount),
      paymentDate: payForm.paymentDate,
      notes: payForm.notes || undefined,
    }), 'Pembayaran dicatat');
    setPayForm((p) => ({ ...p, notes: '' }));
  }

  function voidPayment(p) {
    const reason = window.prompt(`Batalkan pembayaran ${rupiah(p.amount)} (${p.paymentMethodName})?\nTulis alasannya:`);
    if (!reason || !reason.trim()) return;
    run(() => api.voidOrderPayment(orderId, p.id, reason.trim()), 'Pembayaran dibatalkan');
  }

  function saveShipping(statusOverride) {
    run(() => api.updateOrderShipping(orderId, {
      ...shipForm,
      ...(statusOverride ? { shippingStatus: statusOverride } : {}),
    }), statusOverride === 'shipped' ? 'Ditandai sudah dikirim' : statusOverride === 'pending' ? 'Status kirim dikembalikan' : 'Info pengiriman disimpan');
  }

  function voidOrder() {
    const reason = window.prompt(`Void Invoice #${order.invoiceNumber}? Stok akan dikembalikan dan jurnal dibalik.\nTulis alasannya:`);
    if (!reason || !reason.trim()) return;
    run(() => api.voidOrder(orderId, reason.trim()), 'Invoice di-void');
  }

  function printInvoice() {
    const cleanup = () => {
      document.body.classList.remove('printing-invoice');
      window.removeEventListener('afterprint', cleanup);
    };
    document.body.classList.add('printing-invoice');
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 50);
  }

  async function copyWa() {
    try {
      await navigator.clipboard.writeText(buildWaText(order));
      setInfo('Ringkasan invoice disalin — tinggal tempel di WhatsApp');
    } catch {
      setError('Gagal menyalin ke clipboard');
    }
  }

  async function downloadPdf() {
    try {
      await downloadInvoicePdf(order);
    } catch (err) {
      setError(`Gagal membuat PDF: ${err.message}`);
    }
  }

  if (!order) {
    return (
      <div>
        <button className="btn-secondary" onClick={onBack}>‹ Kembali</button>
        <Banner type="error" message={error} onClose={() => setError(null)} />
        {!error && <p>Memuat…</p>}
      </div>
    );
  }

  const voided = order.status === 'voided';
  const activePayments = order.payments.filter((p) => p.status === 'active');
  const pendingLines = groupInvoiceLines(order.items).filter((l) => l.isIndent);

  function fulfill(itemIds) {
    const what = itemIds ? 'barang ini' : 'SEMUA barang indent';
    if (!window.confirm(`Penuhi ${what}? Stok akan dipotong sekarang.`)) return;
    run(() => api.fulfillOrderIndent(orderId, itemIds || undefined), 'Barang indent dipenuhi — stok sudah dipotong');
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn-secondary" onClick={onBack}>‹ Kembali</button>
        <h2 style={{ margin: 0 }}>Invoice #{order.invoiceNumber}</h2>
        {voided ? (
          <span className="status-pill" style={{ background: '#fee2e2', color: '#991b1b' }}>VOID</span>
        ) : (
          <>
            <span className="status-pill" style={paymentBadgeStyle(order.paymentStatus)}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</span>
            <span className="status-pill" style={shippingBadgeStyle(order.shippingStatus)}>{isPickup(order.shippingMethod) && order.shippingStatus === 'shipped' ? 'Sudah diambil' : SHIPPING_STATUS_LABEL[order.shippingStatus]}</span>
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={copyWa}>Salin teks WA</button>
          <button className="btn-secondary" onClick={downloadPdf}>Unduh PDF</button>
          <button className="btn-primary" onClick={printInvoice}>Cetak</button>
        </div>
      </div>
      <div style={{ height: 12 }} />
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <Banner type="success" message={info} onClose={() => setInfo(null)} />

      {voided && (
        <div className="error-banner">
          Di-void {dateTime(order.voidedAt)}{order.voidedByName ? ` oleh ${order.voidedByName}` : ''}. Alasan: {order.voidReason}
        </div>
      )}

      <div className="summary-tiles">
        <div className="summary-tile">
          <div className="label">Pelanggan</div>
          <div className="value" style={{ fontSize: 16 }}>
            {onOpenCustomer && order.customerId
              ? <a href="#" onClick={(e) => { e.preventDefault(); onOpenCustomer(order.customerId); }}>{order.customerName}</a>
              : order.customerName}
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>{[order.customerCity, order.customerPhone].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="summary-tile"><div className="label">Total tagihan</div><div className="value">{rupiah(order.totalDue)}</div></div>
        <div className="summary-tile"><div className="label">Sudah dibayar</div><div className="value">{rupiah(order.amountPaid)}</div></div>
        <div className="summary-tile"><div className="label">Sisa</div><div className="value" style={{ color: Number(order.outstanding) > 0 && !voided ? '#b91c1c' : undefined }}>{rupiah(order.outstanding)}</div></div>
        <div className="summary-tile"><div className="label">Laba kotor</div><div className="value" style={{ fontSize: 16 }}>{rupiah(order.grossProfit)}</div><div style={{ fontSize: 12, color: '#666' }}>BV {Number(order.bvTotal)}</div></div>
      </div>

      {!voided && pendingLines.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #7c3aed' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Barang indent (belum dikirim)</h3>
            {pendingLines.length > 1 && (
              <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => fulfill(null)} disabled={busy}>Penuhi semua</button>
            )}
          </div>
          <p style={{ fontSize: 13, color: '#666', margin: '6px 0 10px' }}>
            Stok barang ini belum dipotong. Klik <strong>Penuhi</strong> saat barangnya sudah ada dan siap dikirim — stok dipotong & HPP dicatat saat itu.
          </p>
          <table>
            <tbody>
              {pendingLines.map((l) => (
                <tr key={l.key}>
                  <td>
                    {l.productName}
                    {l.kind === 'bundle' && <div style={{ fontSize: 12, color: '#666' }}>Isi: {componentsText(l.components)}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty(l.quantity)} {l.unitName}</td>
                  <td style={{ textAlign: 'right', width: 110 }}>
                    <button className="btn-secondary" onClick={() => fulfill(l.itemIds)} disabled={busy}>Penuhi</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Pembayaran</h3>
          <table>
            <thead><tr><th>Tanggal</th><th>Metode</th><th style={{ textAlign: 'right' }}>Jumlah</th><th></th></tr></thead>
            <tbody>
              {order.payments.map((p) => (
                <tr key={p.id} style={p.status === 'voided' ? { color: '#999' } : undefined}>
                  <td>
                    {shortDate(p.paymentDate)}
                    {p.notes && <div style={{ fontSize: 12, color: '#666' }}>{p.notes}</div>}
                  </td>
                  <td>{p.paymentMethodName}</td>
                  <td style={{ textAlign: 'right', textDecoration: p.status === 'voided' ? 'line-through' : undefined }}>{rupiah(p.amount)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {p.status === 'voided'
                      ? <span title={`${p.voidReason || ''} — ${p.voidedByName || ''}`} style={{ fontSize: 12 }}>dibatalkan</span>
                      : <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => voidPayment(p)} disabled={busy}>Batalkan</button>}
                  </td>
                </tr>
              ))}
              {order.payments.length === 0 && <tr><td colSpan={4} style={{ color: '#999', textAlign: 'center' }}>Belum ada pembayaran</td></tr>}
            </tbody>
          </table>

          {!voided && Number(order.outstanding) > 0 && (
            <form onSubmit={addPayment} style={{ borderTop: '1px solid #eee', marginTop: 12, paddingTop: 12 }}>
              <div className="form-grid">
                <div>
                  <label>Metode</label>
                  <select className="input" value={payForm.paymentMethodId} onChange={(e) => setPayForm({ ...payForm, paymentMethodId: e.target.value })}>
                    {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div><label>Jumlah</label><MoneyInput value={payForm.amount} onChange={(v) => setPayForm({ ...payForm, amount: v })} /></div>
                <div><label>Tanggal</label><input className="input" type="date" value={payForm.paymentDate} onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} /></div>
                <div><label>Catatan</label><input className="input" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} placeholder="opsional" /></div>
              </div>
              <button className="btn-primary" type="submit" style={{ marginTop: 10 }} disabled={busy || !Number(payForm.amount)}>Catat pembayaran</button>
            </form>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Pengiriman</h3>
          <div className="form-grid">
            <div>
              <label>Cara kirim</label>
              <input className="input" list="detail-shipping-methods" value={shipForm.shippingMethod} onChange={(e) => setShipForm({ ...shipForm, shippingMethod: e.target.value })} disabled={voided} />
              <datalist id="detail-shipping-methods">{shippingMethods.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            <div>
              <label>No. resi</label>
              <input className="input" value={shipForm.trackingNumber} onChange={(e) => setShipForm({ ...shipForm, trackingNumber: e.target.value })} disabled={voided} />
            </div>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div>
              <label>Alamat kirim</label>
              <textarea className="input" style={{ minHeight: 60, fontFamily: 'inherit' }} value={shipForm.shippingAddress} onChange={(e) => setShipForm({ ...shipForm, shippingAddress: e.target.value })} disabled={voided} />
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
            Ongkir ditagih: <strong>{rupiah(order.shippingFee)}</strong>
            {order.shippedAt && <> · dikirim {dateTime(order.shippedAt)}</>}
          </div>
          {!voided && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={() => saveShipping()} disabled={busy}>Simpan</button>
              {order.shippingStatus === 'pending' ? (
                <button className="btn-primary" onClick={() => saveShipping('shipped')} disabled={busy}>
                  {isPickup(shipForm.shippingMethod) ? 'Tandai sudah diambil' : 'Tandai sudah dikirim'}
                </button>
              ) : (
                <button className="btn-secondary" onClick={() => saveShipping('pending')} disabled={busy}>Kembalikan ke belum dikirim</button>
              )}
            </div>
          )}
          {!voided && order.shippingStatus === 'pending' && pendingLines.length > 0 && (
            <div style={{ fontSize: 12, color: '#7c3aed', marginTop: 8 }}>
              Masih ada barang indent. Kalau sebagian dikirim dulu, tandai terkirim sekarang dan penuhi indentnya nanti.
            </div>
          )}
          {!voided && order.shippingStatus === 'pending' && order.paymentStatus !== 'paid' && (
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>Invoice belum lunas — pastikan memang boleh dikirim dulu (piutang).</div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Pratinjau invoice</h3>
          <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setShowPreview((v) => !v)}>{showPreview ? 'Sembunyikan' : 'Tampilkan'}</button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
            Dibuat {dateTime(order.createdAt)}{order.createdByName ? ` oleh ${order.createdByName}` : ''}
          </span>
        </div>
        {showPreview && (
          <div style={{ background: '#e5e7eb', padding: 16, marginTop: 12, borderRadius: 8, overflowX: 'auto' }}>
            <div style={{ margin: '0 auto', width: 'fit-content' }}>
              <InvoiceDocument order={order} />
            </div>
          </div>
        )}
      </div>

      {!voided && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="btn-danger" onClick={voidOrder} disabled={busy}>Void invoice</button>
          {activePayments.length > 0 && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Batalkan semua pembayaran dulu sebelum void.</div>}
        </div>
      )}

      {createPortal(
        <div className="invoice-print-root"><InvoiceDocument order={order} /></div>,
        document.body,
      )}
    </div>
  );
}
