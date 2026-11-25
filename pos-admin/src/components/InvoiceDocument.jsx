import { rupiah, qty, longDate, groupInvoiceLines, componentsText } from '../utils/format.js';

// Lembar invoice A4 (HTML) — dipakai pratinjau di layar & cetak (window.print).
// Versi PDF yang setara ada di utils/invoicePdf.js — kalau tata letak di sini
// diubah, sesuaikan juga di sana supaya hasil cetak & PDF tidak beda isi.
export default function InvoiceDocument({ order }) {
  const s = order.invoiceSettings || {};
  const hasDiscount = Number(order.discountTotal) > 0;
  const hasPpn = Number(order.ppnAmount) > 0;
  const hasShipping = Number(order.shippingFee) > 0;
  const outstanding = Number(order.outstanding);
  const paidSome = Number(order.amountPaid) > 0;
  const stamp = order.status === 'voided' ? 'BATAL' : order.paymentStatus === 'paid' ? 'LUNAS' : null;

  return (
    <div className="invoice-sheet">
      {stamp && <div className={`invoice-stamp${order.status === 'voided' ? ' void' : ''}`}>{stamp}</div>}

      <div className="invoice-head">
        <div className="invoice-brand">
          {s.logo && <img src={s.logo} alt="" className="invoice-logo" />}
          <div>
            <div className="invoice-store-name">{s.storeName}</div>
            {s.storeAddress && <div>{s.storeAddress}</div>}
            {s.storePhone && <div>{s.storePhone}</div>}
          </div>
        </div>
        <div className="invoice-title-block">
          <div className="invoice-title">INVOICE</div>
          <table className="invoice-meta">
            <tbody>
              <tr><td>No.</td><td><strong>{order.invoiceNumber}</strong></td></tr>
              <tr><td>Tanggal</td><td>{longDate(order.invoiceDate)}</td></tr>
              {order.dueDate && <tr><td>Jatuh tempo</td><td>{longDate(order.dueDate)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="invoice-to">
        <div className="invoice-label">Kepada Yth.</div>
        <div className="invoice-customer">{order.customerName}{order.customerCity ? ` — ${order.customerCity}` : ''}</div>
        {order.customerPhone && <div>{order.customerPhone}</div>}
        {order.shippingAddress && <div style={{ whiteSpace: 'pre-line' }}>{order.shippingAddress}</div>}
      </div>

      <table className="invoice-items">
        <thead>
          <tr>
            <th style={{ width: 32 }}>No</th>
            <th>Nama Barang</th>
            <th style={{ width: 70, textAlign: 'right' }}>Qty</th>
            <th style={{ width: 120, textAlign: 'right' }}>Harga</th>
            <th style={{ width: 130, textAlign: 'right' }}>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {groupInvoiceLines(order.items).map((it, idx) => (
            <tr key={it.key}>
              <td>{idx + 1}</td>
              <td>
                {it.productName}
                {it.isBonus && <span className="invoice-free-tag">FREE</span>}
                {it.isIndent && <span className="invoice-free-tag invoice-indent-tag">INDENT</span>}
                {it.kind === 'bundle' && <div className="invoice-sub">Isi: {componentsText(it.components)}</div>}
                {Number(it.discountAmount) > 0 && <div className="invoice-sub">Diskon {rupiah(it.discountAmount)}</div>}
              </td>
              <td style={{ textAlign: 'right' }}>{qty(it.quantity)} {it.unitName}</td>
              <td style={{ textAlign: 'right' }}>{it.isBonus ? '-' : rupiah(it.sellingPrice)}</td>
              <td style={{ textAlign: 'right' }}>{it.isBonus ? 'GRATIS' : rupiah(it.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-bottom">
        <div className="invoice-notes">
          {order.notes && <div style={{ whiteSpace: 'pre-line', marginBottom: 10 }}>{order.notes}</div>}
        </div>
        <table className="invoice-totals">
          <tbody>
            {(hasDiscount || hasPpn || hasShipping) && (
              <tr><td>Subtotal</td><td>{rupiah(order.subtotal)}</td></tr>
            )}
            {hasDiscount && <tr><td>Diskon</td><td>-{rupiah(order.discountTotal)}</td></tr>}
            {hasPpn && (
              <tr>
                <td>PPN {Number(order.ppnRate)}%{order.ppnMode === 'included' ? ' (termasuk)' : ''}</td>
                <td>{order.ppnMode === 'included' ? rupiah(order.ppnAmount) : `+${rupiah(order.ppnAmount)}`}</td>
              </tr>
            )}
            {hasShipping && <tr><td>Ongkir{order.shippingMethod ? ` (${order.shippingMethod})` : ''}</td><td>{rupiah(order.shippingFee)}</td></tr>}
            <tr className="invoice-grand"><td>TOTAL</td><td>{rupiah(order.totalDue)}</td></tr>
            {paidSome && outstanding > 0 && (
              <>
                <tr><td>Sudah dibayar</td><td>{rupiah(order.amountPaid)}</td></tr>
                <tr className="invoice-grand"><td>SISA TAGIHAN</td><td>{rupiah(order.outstanding)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="invoice-footer">
        <div className="invoice-bank">
          {s.bankInfo && (
            <>
              <div className="invoice-label">Pembayaran via transfer ke:</div>
              <div style={{ whiteSpace: 'pre-line', fontWeight: 600 }}>{s.bankInfo}</div>
            </>
          )}
        </div>
        <div className="invoice-sign">
          <div>Hormat kami,</div>
          <div className="invoice-sign-space" />
          <div className="invoice-sign-name">{s.signerName || ' '}</div>
        </div>
      </div>

      {s.footerNote && <div className="invoice-footnote">{s.footerNote}</div>}
    </div>
  );
}
