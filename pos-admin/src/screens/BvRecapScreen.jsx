import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';
import { rupiah, qty } from '../utils/format.js';
import { exportToExcel } from '../utils/export.js';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${pad(last)}` };
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

const bvFmt = (v) => Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });

// Rekap poin BV dari invoice (tidak termasuk yang di-void), per bulan
// tanggal invoice — per pelanggan & per produk.
export default function BvRecapScreen() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!month) return;
    const { startDate, endDate } = monthRange(month);
    api.getBvRecap({ startDate, endDate }).then((d) => setReport(d.report)).catch((err) => setError(err.message));
  }, [month]);

  function exportExcel() {
    exportToExcel(
      `Rekap-BV-${month}.xlsx`,
      'Per produk',
      [
        { header: 'Produk', key: 'productName', width: 36 },
        { header: 'Kode', key: 'sku', width: 12 },
        { header: 'Qty', key: 'qty', width: 10 },
        { header: 'Satuan', key: 'unit', width: 10 },
        { header: 'BV', key: 'bv', width: 10 },
        { header: 'Nilai jual', key: 'value', width: 16 },
      ],
      report.products.map((p) => ({
        productName: p.productName, sku: p.sku || '', qty: Number(p.qtyBase), unit: p.baseUnitName, bv: Number(p.bv), value: Number(p.goodsValue),
      })),
    );
  }

  return (
    <div>
      <h2>Rekap Poin BV</h2>
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <div className="inline-form">
        <label style={{ fontSize: 13 }}>Bulan <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        {report && report.products.length > 0 && <button className="btn-secondary" onClick={exportExcel} style={{ marginLeft: 'auto' }}>Unduh Excel</button>}
      </div>

      {report && (
        <>
          <div className="summary-tiles">
            <div className="summary-tile"><div className="label">Total BV — {monthLabel(month)}</div><div className="value">{bvFmt(report.totalBv)}</div></div>
            <div className="summary-tile"><div className="label">Invoice</div><div className="value">{report.invoiceCount}</div></div>
            <div className="summary-tile"><div className="label">Nilai jual barang</div><div className="value">{rupiah(report.goodsValue)}</div></div>
            {Number(report.pendingBv) > 0 && (
              <div className="summary-tile"><div className="label">Termasuk BV barang indent (belum dikirim)</div><div className="value" style={{ color: '#7c3aed' }}>{bvFmt(report.pendingBv)}</div></div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Per produk</h3>
              <table>
                <thead><tr><th>Produk</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>BV</th></tr></thead>
                <tbody>
                  {report.products.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.productName}{p.sku ? <span style={{ color: '#888' }}> · {p.sku}</span> : null}</td>
                      <td style={{ textAlign: 'right' }}>{qty(p.qtyBase)} {p.baseUnitName}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{bvFmt(p.bv)}</td>
                    </tr>
                  ))}
                  {report.products.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#999', padding: 16 }}>Belum ada penjualan bulan ini</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Per pelanggan</h3>
              <table>
                <thead><tr><th>Pelanggan</th><th style={{ textAlign: 'right' }}>Invoice</th><th style={{ textAlign: 'right' }}>Nilai</th><th style={{ textAlign: 'right' }}>BV</th></tr></thead>
                <tbody>
                  {report.customers.map((c) => (
                    <tr key={c.customerId || c.customerName}>
                      <td>{c.customerName}{c.customerCity ? <span style={{ color: '#888' }}> — {c.customerCity}</span> : null}</td>
                      <td style={{ textAlign: 'right' }}>{c.invoiceCount}</td>
                      <td style={{ textAlign: 'right' }}>{rupiah(c.goodsValue)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{bvFmt(c.bv)}</td>
                    </tr>
                  ))}
                  {report.customers.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#999', padding: 16 }}>-</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#888' }}>
            BV dihitung dari invoice yang tidak di-void, menurut tanggal invoice. BV tiap barang = poin BV produk (per satuan dasar) saat invoice dibuat; barang bonus tidak dapat BV.
          </p>
        </>
      )}
    </div>
  );
}
