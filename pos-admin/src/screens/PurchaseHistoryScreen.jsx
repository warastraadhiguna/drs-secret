import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import JournalPreview from '../components/JournalPreview.jsx';
import Banner from '../components/Banner.jsx';

function rp(n) {
  return `Rp${Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function InterveningNote({ movements }) {
  if (!movements || movements.length === 0) return null;
  const productNames = [...new Set(movements.map((m) => m.product_name))];
  return (
    <div className="error-banner" style={{ border: '2px solid #d97706', background: '#fffbeb', color: '#92400e', fontSize: 13 }}>
      ⚠️ Ada {movements.length} transaksi lain terjadi SEJAK pembelian ini dibuat, melibatkan: {productNames.join(', ')}.
      Selisih tetap dihitung dgn benar (nilai pembelian ini dikeluarkan persis dari pool saat ini), tapi avg cost hasilnya
      bisa terlihat tidak seperti harga wajar manapun — itu konsekuensi matematis yang tak terhindarkan, bukan kesalahan
      hitung, begitu ada transaksi lain memakai stok yang sama sebelum pembelian ini di-void.
    </div>
  );
}

const PAGE_SIZE = 20;

export default function PurchaseHistoryScreen() {
  const [purchases, setPurchases] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);

  const [voidingId, setVoidingId] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidResult, setVoidResult] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function reload(targetPage = page) {
    api.listPurchases({ q: query, dateFrom, dateTo, page: targetPage, limit: PAGE_SIZE })
      .then((d) => {
        setPurchases(d.purchases);
        setTotal(d.total);
        setPage(d.page);
      })
      .catch((err) => setError(err.message));
  }

  // Filter TIDAK otomatis jalan tiap ketik/ganti tanggal (beda dari pola
  // sebelumnya) — baru diterapkan begitu tombol "Cari" diklik/form
  // disubmit. Diminta eksplisit: auto-filter bikin query berulang2 kalau
  // datanya banyak. Cuma load AWAL (mount) yang otomatis.
  useEffect(() => {
    reload(1);
    api.listAccountingAccounts().then((d) => setAccounts(d.accounts)).catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitFilter(e) {
    e?.preventDefault();
    reload(1);
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  function accountLabel(id) {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : id;
  }

  function openDetail(purchaseId) {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    api.getPurchase(purchaseId)
      .then((d) => setDetail(d.purchase))
      .catch((err) => setError(err.message))
      .finally(() => setDetailLoading(false));
  }
  function closeDetail() {
    setDetailOpen(false);
    setDetail(null);
  }

  function startVoid(purchaseId) {
    setVoidingId(purchaseId);
    setVoidReason('');
    setVoidResult(null);
  }
  function cancelVoid() {
    setVoidingId(null);
    setVoidReason('');
  }
  async function confirmVoid(purchaseId) {
    if (!voidReason.trim()) {
      setError('Alasan void wajib diisi');
      return;
    }
    setError(null);
    try {
      const result = await api.voidPurchase(purchaseId, { reason: voidReason.trim() });
      setVoidResult(result);
      setVoidingId(null);
      setVoidReason('');
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2>Riwayat Pembelian</h2>
      <Banner type="error" message={error} onClose={() => setError(null)} />

      {voidResult && (
        <div className="card" style={{ marginBottom: 20 }}>
          <strong>Hasil Void Pembelian {voidResult.purchaseNumber}</strong>
          <InterveningNote movements={voidResult.interveningMovements} />
          {voidResult.journalEntry ? (
            <JournalPreview entry={voidResult.journalEntry} accountLabel={accountLabel} />
          ) : (
            <div style={{ fontSize: 13, color: '#999', marginTop: 8 }}>Tidak ada jurnal untuk dibalik.</div>
          )}
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Produk</th><th>Stok Sebelum</th><th>Avg Cost Sebelum</th><th>Stok Sesudah</th><th>Avg Cost Sesudah</th><th></th></tr></thead>
            <tbody>
              {voidResult.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.productName || it.productId}</td>
                  <td>{Number(it.qtyBaseBefore).toLocaleString('id-ID')}</td>
                  <td>{rp(it.avgCostBefore)}</td>
                  <td>{Number(it.qtyBaseAfter).toLocaleString('id-ID')}</td>
                  <td>{rp(it.avgCostAfter)}</td>
                  <td>{it.hadInterveningTransaction && <span className="badge inactive">ada transaksi di tengah</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <form className="inline-form" style={{ marginBottom: 12 }} onSubmit={submitFilter}>
          <input
            className="input"
            style={{ width: '100%', maxWidth: 320 }}
            placeholder="Cari No. Pembelian / Supplier..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span style={{ color: '#666' }}>s/d</span>
          <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button className="btn-primary" type="submit">Cari</button>
        </form>
        <table>
          <thead><tr><th>No. Pembelian</th><th>Tanggal</th><th>Supplier</th><th>DPP</th><th>PPN Masukan</th><th>Total</th><th>Bayar</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {purchases.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  <td>{p.purchase_number}</td>
                  <td>{new Date(p.purchase_date).toLocaleDateString('id-ID')}</td>
                  <td>{p.supplier_name}</td>
                  <td>{rp(p.dpp)}</td>
                  <td>
                    {!p.ppn_mode && '-'}
                    {p.ppn_mode && Number(p.ppn_amount) > 0 && `${rp(p.ppn_amount)} (${p.ppn_mode === 'exclude' ? 'exclude' : 'included'})`}
                    {p.ppn_mode && Number(p.ppn_amount) === 0 && 'melebur ke HPP (non-PKP)'}
                  </td>
                  <td>{rp(p.grand_total)}</td>
                  <td>{p.payment_type === 'cash' ? 'Tunai' : 'Kredit'}</td>
                  <td><span className={`badge ${p.status === 'completed' ? 'active' : 'inactive'}`}>{p.status === 'completed' ? 'Selesai' : 'Void'}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-secondary" onClick={() => openDetail(p.id)}>Detail</button>
                    {p.status === 'completed' && voidingId !== p.id && (
                      <button className="btn-danger" onClick={() => startVoid(p.id)}>Void</button>
                    )}
                  </td>
                </tr>
                {voidingId === p.id && (
                  <tr>
                    <td colSpan={9}>
                      <div className="inline-form" style={{ margin: 0 }}>
                        <input
                          className="input" placeholder="Alasan void (wajib)" style={{ flex: 1, minWidth: 240 }}
                          value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus
                        />
                        <button className="btn-danger" onClick={() => confirmVoid(p.id)} disabled={!voidReason.trim()}>Konfirmasi Void</button>
                        <button className="btn-secondary" onClick={cancelVoid}>Batal</button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {purchases.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: '#999', padding: 20 }}>
                {query || dateFrom || dateTo ? 'Tidak ada pembelian yang cocok dengan filter ini' : 'Belum ada pembelian'}
              </td></tr>
            )}
          </tbody>
        </table>

        {total > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span style={{ fontSize: 13, color: '#666' }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} dari {total} pembelian
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-secondary" disabled={page <= 1} onClick={() => reload(page - 1)}>&larr; Sebelumnya</button>
              <span style={{ fontSize: 13, color: '#666' }}>Halaman {page} / {totalPages}</span>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => reload(page + 1)}>Berikutnya &rarr;</button>
            </div>
          </div>
        )}
      </div>

      {detailOpen && (
        <div className="modal-overlay">
          <div className="card" style={{ width: 700, maxHeight: '85vh', overflowY: 'auto' }}>
            <button type="button" className="modal-close-btn" onClick={closeDetail} title="Tutup">✕</button>
            {detailLoading && <p style={{ color: '#999' }}>Memuat detail...</p>}
            {!detailLoading && detail && (
              <>
                <h3 style={{ marginTop: 0 }}>Detail Pembelian {detail.purchase_number}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 13, marginBottom: 12 }}>
                  <div><span style={{ color: '#666' }}>Tanggal</span><br /><strong>{new Date(detail.purchase_date).toLocaleDateString('id-ID')}</strong></div>
                  <div><span style={{ color: '#666' }}>Supplier</span><br /><strong>{detail.supplier_name}</strong></div>
                  <div><span style={{ color: '#666' }}>Jenis Bayar</span><br /><strong>{detail.payment?.payment_type === 'cash' ? 'Tunai' : 'Kredit'}</strong></div>
                  <div>
                    <span style={{ color: '#666' }}>Status</span><br />
                    <span className={`badge ${detail.status === 'completed' ? 'active' : 'inactive'}`}>{detail.status === 'completed' ? 'Selesai' : 'Void'}</span>
                  </div>
                </div>
                {detail.notes && (
                  <div style={{ fontSize: 13, marginBottom: 12 }}>
                    <span style={{ color: '#666' }}>Catatan</span><br />{detail.notes}
                  </div>
                )}
                {detail.status === 'voided' && (
                  <div className="error-banner" style={{ fontSize: 13, marginBottom: 12 }}>
                    Di-void {detail.voided_at ? new Date(detail.voided_at).toLocaleString('id-ID') : ''} — Alasan: {detail.void_reason || '-'}
                  </div>
                )}

                <table style={{ marginBottom: 12 }}>
                  <thead><tr><th>Produk</th><th>Satuan</th><th>Qty</th><th>Harga/Satuan</th><th>Diskon</th><th>Subtotal</th></tr></thead>
                  <tbody>
                    {detail.items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.product_name}</td>
                        <td>{it.unit_name}</td>
                        <td>{Number(it.quantity).toLocaleString('id-ID')}</td>
                        <td>{rp(it.cost_per_unit)}</td>
                        <td>{Number(it.discount_amount) > 0 ? `- ${rp(it.discount_amount)}` : '-'}</td>
                        <td>{rp(it.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ minWidth: 260, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>Subtotal</span><span>{rp(detail.subtotal)}</span>
                    </div>
                    {Number(detail.discount_total) > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span>Diskon Total</span><span>- {rp(detail.discount_total)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>DPP</span><span>{rp(detail.dpp)}</span>
                    </div>
                    {detail.ppn_mode && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span>PPN Masukan ({Number(detail.ppn_rate)}%, {detail.ppn_mode === 'exclude' ? 'exclude' : 'included'})</span>
                        <span>{rp(detail.ppn_amount)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, borderTop: '1px solid #ddd', paddingTop: 6, marginTop: 4 }}>
                      <span>Total</span><span>{rp(detail.grand_total)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
