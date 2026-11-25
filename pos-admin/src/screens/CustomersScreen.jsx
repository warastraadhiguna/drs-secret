import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';
import {
  rupiah, qty, shortDate, PAYMENT_STATUS_LABEL, SHIPPING_STATUS_LABEL, paymentBadgeStyle, shippingBadgeStyle,
} from '../utils/format.js';

const emptyForm = { name: '', phone: '', city: '', address: '', notes: '' };

export default function CustomersScreen({ onOpenOrder, initialCustomerId = null }) {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedId, setSelectedId] = useState(initialCustomerId);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const limit = 50;

  function reload() {
    api.listCustomers({ q, includeInactive, page, limit })
      .then((d) => { setCustomers(d.customers); setTotal(d.total); })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [q, includeInactive, page]);

  async function submitCreate(e) {
    e.preventDefault();
    try {
      await api.createCustomer(form);
      setForm(emptyForm);
      setShowAdd(false);
      setInfo('Pelanggan ditambahkan');
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  if (selectedId) {
    return (
      <CustomerDetail
        id={selectedId}
        onBack={() => { setSelectedId(null); reload(); }}
        onOpenOrder={onOpenOrder}
      />
    );
  }

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <h2>Pelanggan</h2>
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <Banner type="success" message={info} onClose={() => setInfo(null)} />

      <div className="inline-form">
        <input className="input" style={{ minWidth: 280 }} placeholder="Cari nama / telepon / kota…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Tampilkan nonaktif
        </label>
        <button className="btn-primary" onClick={() => setShowAdd((v) => !v)} style={{ marginLeft: 'auto' }}>
          {showAdd ? 'Tutup' : '+ Pelanggan baru'}
        </button>
      </div>

      {showAdd && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={submitCreate}>
          <div className="form-grid">
            <div><label>Nama *</label><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label>Telepon/WA</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label>Kota</label><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div><label>Alamat kirim</label><textarea className="input" style={{ minHeight: 56, fontFamily: 'inherit' }} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><label>Catatan</label><textarea className="input" style={{ minHeight: 56, fontFamily: 'inherit' }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <button className="btn-primary" type="submit" style={{ marginTop: 12 }} disabled={!form.name.trim()}>Simpan</button>
        </form>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Nama</th><th>Kota</th><th>Telepon</th>
              <th style={{ textAlign: 'right' }}>Invoice</th>
              <th style={{ textAlign: 'right' }}>Total belanja</th>
              <th style={{ textAlign: 'right' }}>Piutang</th>
              <th>Terakhir</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => setSelectedId(c.id)}>
                <td>
                  {c.name}
                  {!c.isActive && <span className="badge inactive" style={{ marginLeft: 6 }}>Nonaktif</span>}
                </td>
                <td>{c.city || '-'}</td>
                <td>{c.phone || '-'}</td>
                <td style={{ textAlign: 'right' }}>{c.orderCount}</td>
                <td style={{ textAlign: 'right' }}>{rupiah(c.totalSpent)}</td>
                <td style={{ textAlign: 'right', color: Number(c.outstanding) > 0 ? '#b91c1c' : undefined }}>
                  {Number(c.outstanding) > 0 ? rupiah(c.outstanding) : '-'}
                </td>
                <td>{c.lastOrderDate ? shortDate(c.lastOrderDate) : '-'}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: 20 }}>Belum ada pelanggan</td></tr>
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

function CustomerDetail({ id, onBack, onOpenOrder }) {
  const [customer, setCustomer] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  function load() {
    api.getCustomer(id).then((d) => {
      setCustomer(d.customer);
      setForm({
        name: d.customer.name || '',
        phone: d.customer.phone || '',
        city: d.customer.city || '',
        address: d.customer.address || '',
        notes: d.customer.notes || '',
      });
    }).catch((err) => setError(err.message));
  }
  useEffect(load, [id]);

  async function save(e) {
    e.preventDefault();
    try {
      await api.updateCustomer(id, form);
      setInfo('Data pelanggan disimpan');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive() {
    try {
      await api.updateCustomer(id, { isActive: !customer.isActive });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!customer) return <div>Memuat… <Banner type="error" message={error} onClose={() => setError(null)} /></div>;

  return (
    <div>
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: 12 }}>‹ Kembali ke daftar</button>
      <h2 style={{ marginTop: 0 }}>
        {customer.name}
        {!customer.isActive && <span className="badge inactive" style={{ marginLeft: 8, fontSize: 12 }}>Nonaktif</span>}
      </h2>
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <Banner type="success" message={info} onClose={() => setInfo(null)} />

      <div className="summary-tiles">
        <div className="summary-tile"><div className="label">Jumlah invoice</div><div className="value">{customer.orderCount}</div></div>
        <div className="summary-tile"><div className="label">Total belanja</div><div className="value">{rupiah(customer.totalSpent)}</div></div>
        <div className="summary-tile"><div className="label">Piutang</div><div className="value" style={{ color: Number(customer.outstanding) > 0 ? '#b91c1c' : undefined }}>{rupiah(customer.outstanding)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <form className="card" onSubmit={save}>
          <h3 style={{ marginTop: 0 }}>Data pelanggan</h3>
          <div className="form-grid">
            <div><label>Nama *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label>Telepon/WA</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label>Kota</label><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div><label>Alamat kirim (default)</label><textarea className="input" style={{ minHeight: 64, fontFamily: 'inherit' }} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div><label>Catatan</label><textarea className="input" style={{ minHeight: 48, fontFamily: 'inherit' }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" type="submit" disabled={!form.name.trim()}>Simpan</button>
            <button className="btn-secondary" type="button" onClick={toggleActive}>{customer.isActive ? 'Nonaktifkan' : 'Aktifkan lagi'}</button>
          </div>
        </form>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Produk paling sering dibeli</h3>
          <table>
            <thead><tr><th>Produk</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Nilai</th></tr></thead>
            <tbody>
              {customer.topProducts.map((p) => (
                <tr key={p.productId}>
                  <td>{p.productName}</td>
                  <td style={{ textAlign: 'right' }}>{qty(p.qtyBase)} {p.baseUnitName}</td>
                  <td style={{ textAlign: 'right' }}>{rupiah(p.amount)}</td>
                </tr>
              ))}
              {customer.topProducts.length === 0 && <tr><td colSpan={3} style={{ color: '#999', textAlign: 'center' }}>Belum ada</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Riwayat invoice</h3>
        <table>
          <thead>
            <tr><th>No.</th><th>Tanggal</th><th style={{ textAlign: 'right' }}>Total</th><th>Bayar</th><th>Kirim</th><th>Resi</th></tr>
          </thead>
          <tbody>
            {customer.orders.map((o) => (
              <tr key={o.id} className={onOpenOrder ? 'clickable' : ''} onClick={() => onOpenOrder && onOpenOrder(o.id)} style={o.status === 'voided' ? { color: '#999', textDecoration: 'line-through' } : undefined}>
                <td>#{o.invoiceNumber || o.saleNumber}</td>
                <td>{o.invoiceDate ? shortDate(o.invoiceDate) : shortDate(o.createdAt)}</td>
                <td style={{ textAlign: 'right' }}>{rupiah(o.totalDue)}</td>
                <td>{o.status === 'voided' ? 'Void' : <span className="status-pill" style={paymentBadgeStyle(o.paymentStatus)}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</span>}</td>
                <td>{o.status === 'voided' ? '' : <span className="status-pill" style={shippingBadgeStyle(o.shippingStatus)}>{SHIPPING_STATUS_LABEL[o.shippingStatus]}</span>}</td>
                <td>{o.shippingMethod || ''}{o.trackingNumber ? ` · ${o.trackingNumber}` : ''}</td>
              </tr>
            ))}
            {customer.orders.length === 0 && <tr><td colSpan={6} style={{ color: '#999', textAlign: 'center', padding: 16 }}>Belum ada invoice</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
