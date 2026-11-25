import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';
import OrderCreateScreen from './OrderCreateScreen.jsx';
import OrderDetailScreen from './OrderDetailScreen.jsx';
import {
  rupiah, shortDate, isPickup, PAYMENT_STATUS_LABEL, SHIPPING_STATUS_LABEL, paymentBadgeStyle, shippingBadgeStyle,
} from '../utils/format.js';

const TABS = [
  { key: 'all', label: 'Semua', filters: {} },
  { key: 'outstanding', label: 'Belum lunas', filters: { paymentStatus: 'outstanding' } },
  { key: 'toShip', label: 'Belum dikirim', filters: { shippingStatus: 'pending' } },
  { key: 'indent', label: 'Indent', filters: { indent: 'pending' } },
  { key: 'shipped', label: 'Sudah dikirim', filters: { shippingStatus: 'shipped' } },
  { key: 'voided', label: 'Void', filters: { status: 'voided' } },
];

// Invoice/Pesanan — daftar + buat + detail dalam satu layar (mode internal).
export default function OrdersScreen({ initialMode = 'list', initialOrderId = null, onOpenCustomer }) {
  const [mode, setMode] = useState(initialOrderId ? 'detail' : initialMode);
  const [orderId, setOrderId] = useState(initialOrderId);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const limit = 50;

  useEffect(() => {
    if (mode !== 'list') return;
    const filters = TABS.find((t) => t.key === tab).filters;
    const t = setTimeout(() => {
      api.listOrders({ ...filters, q, startDate, endDate, page, limit })
        .then(setData)
        .catch((err) => setError(err.message));
    }, 250);
    return () => clearTimeout(t);
  }, [mode, tab, q, startDate, endDate, page]);

  if (mode === 'create') {
    return (
      <OrderCreateScreen
        onCancel={initialMode === 'create' ? null : () => setMode('list')}
        onCreated={(order) => { setOrderId(order.id); setMode('detail'); }}
      />
    );
  }
  if (mode === 'detail' && orderId) {
    return (
      <OrderDetailScreen
        orderId={orderId}
        onBack={() => { setMode('list'); setOrderId(null); }}
        onOpenCustomer={onOpenCustomer}
      />
    );
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Invoice / Pesanan</h2>
        <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setMode('create')}>+ Buat invoice</button>
      </div>
      <div style={{ height: 12 }} />
      <Banner type="error" message={error} onClose={() => setError(null)} />

      {data && (
        <div className="summary-tiles">
          <div className="summary-tile">
            <div className="label">Total piutang (semua invoice)</div>
            <div className="value" style={{ color: Number(data.receivable.outstanding) > 0 ? '#b91c1c' : undefined }}>{rupiah(data.receivable.outstanding)}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{data.receivable.count} invoice belum lunas</div>
          </div>
          <div className="summary-tile">
            <div className="label">Invoice di daftar ini</div>
            <div className="value">{data.total}</div>
          </div>
          <div className="summary-tile">
            <div className="label">Total tagihan di daftar ini</div>
            <div className="value">{rupiah(data.summary.totalDue)}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'btn-primary' : 'btn-secondary'}
            onClick={() => { setTab(t.key); setPage(1); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="inline-form">
        <input className="input" style={{ minWidth: 260 }} placeholder="Cari no. invoice / nama / kota / resi…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <label style={{ fontSize: 13 }}>Dari <input className="input" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} /></label>
        <label style={{ fontSize: 13 }}>s/d <input className="input" type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} /></label>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>No.</th><th>Tanggal</th><th>Pelanggan</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Sisa</th>
              <th>Bayar</th><th>Kirim</th>
            </tr>
          </thead>
          <tbody>
            {data?.orders.map((o) => {
              const voided = o.status === 'voided';
              return (
                <tr key={o.id} className="clickable" onClick={() => { setOrderId(o.id); setMode('detail'); }} style={voided ? { color: '#999' } : undefined}>
                  <td><strong>#{o.invoiceNumber}</strong></td>
                  <td>{shortDate(o.invoiceDate)}</td>
                  <td>{o.customerName}{o.customerCity ? <span style={{ color: '#888' }}> — {o.customerCity}</span> : null}</td>
                  <td style={{ textAlign: 'right', textDecoration: voided ? 'line-through' : undefined }}>{rupiah(o.totalDue)}</td>
                  <td style={{ textAlign: 'right', color: !voided && Number(o.outstanding) > 0 ? '#b91c1c' : undefined }}>
                    {!voided && Number(o.outstanding) > 0 ? rupiah(o.outstanding) : '-'}
                  </td>
                  <td>{voided ? 'Void' : <span className="status-pill" style={paymentBadgeStyle(o.paymentStatus)}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</span>}</td>
                  <td>
                    {!voided && (
                      <span className="status-pill" style={shippingBadgeStyle(o.shippingStatus)}>
                        {isPickup(o.shippingMethod) && o.shippingStatus === 'shipped' ? 'Diambil' : SHIPPING_STATUS_LABEL[o.shippingStatus]}
                      </span>
                    )}
                    {!voided && o.pendingItemCount > 0 && (
                      <span className="status-pill" style={{ background: '#ede9fe', color: '#5b21b6', marginLeft: 4 }}>Indent {o.pendingItemCount}</span>
                    )}
                    <span style={{ fontSize: 12, color: '#666', marginLeft: 6 }}>
                      {o.shippingMethod || ''}{o.trackingNumber ? ` · ${o.trackingNumber}` : ''}
                    </span>
                  </td>
                </tr>
              );
            })}
            {data && data.orders.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: 20 }}>Tidak ada invoice</td></tr>
            )}
          </tbody>
        </table>
        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 12 }}>
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
            <span style={{ fontSize: 13 }}>Hal {page} / {pages}</span>
            <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}
