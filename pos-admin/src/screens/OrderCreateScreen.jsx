import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import ProductSearchSelect from '../components/ProductSearchSelect.jsx';
import CustomerPicker from '../components/CustomerPicker.jsx';
import { rupiah, todayStr, isPickup } from '../utils/format.js';

let lineSeq = 0;

// Buat Invoice/Pesanan. Harga & total SELALU dari server (/admin/orders/quote)
// — layar ini cuma mengirim produk/satuan/qty/bonus/diskon dan menampilkan
// hasil hitungan server.
export default function OrderCreateScreen({ onCreated, onCancel }) {
  const [customer, setCustomer] = useState(null);
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [dueDate, setDueDate] = useState('');
  const [priceLevels, setPriceLevels] = useState([]);
  const [priceLevelId, setPriceLevelId] = useState('');
  const [lines, setLines] = useState([]);
  const [totalDiscount, setTotalDiscount] = useState('');
  const [shippingMethod, setShippingMethod] = useState('');
  const [shippingFee, setShippingFee] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [shippingMethods, setShippingMethods] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [payNow, setPayNow] = useState(false);
  const [payment, setPayment] = useState({ paymentMethodId: '', amount: '', paymentDate: todayStr() });
  const [belowCostReason, setBelowCostReason] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchKey, setSearchKey] = useState(0);
  const [bundles, setBundles] = useState([]);
  const payAmountTouched = useRef(false);

  useEffect(() => {
    api.listPriceLevels().then((d) => {
      const levels = d.priceLevels || d.levels || [];
      setPriceLevels(levels);
      if (levels[0]) setPriceLevelId(levels[0].id);
    }).catch((err) => setError(err.message));
    api.listShippingMethods().then((d) => setShippingMethods(d.methods)).catch(() => {});
    api.listBundles().then((d) => setBundles(d.bundles)).catch(() => {});
    api.listActivePaymentMethods().then((d) => {
      setPaymentMethods(d.methods);
      if (d.methods[0]) setPayment((p) => ({ ...p, paymentMethodId: d.methods[0].id }));
    }).catch(() => {});
  }, []);

  function selectCustomer(c) {
    setCustomer(c);
    setShippingAddress(c ? c.address || '' : '');
  }

  async function addProduct(product) {
    if (!product) return;
    try {
      const d = await api.getProductForSale(product.id);
      lineSeq += 1;
      setLines((prev) => [...prev, {
        key: `l${lineSeq}`,
        productId: d.product.id,
        productName: d.product.name,
        sku: d.product.sku,
        units: d.units,
        unitId: d.matchedUnit.unit_id,
        quantity: '1',
        isBonus: false,
        discount: '',
      }]);
      setSearchKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  function addBundle(bundleId) {
    const b = bundles.find((x) => x.id === bundleId);
    if (!b) return;
    lineSeq += 1;
    setLines((prev) => [...prev, { key: `l${lineSeq}`, kind: 'bundle', bundleId: b.id, productName: b.name, sku: b.code, quantity: '1' }]);
  }

  function updateLine(key, patch) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const payloadItems = useMemo(() => lines
    .filter((l) => Number(l.quantity) > 0)
    .map((l) => (l.kind === 'bundle' ? {
      clientKey: l.key,
      bundleId: l.bundleId,
      quantity: Number(l.quantity),
      priceLevelId,
      isIndent: !!l.isIndent,
    } : {
      clientKey: l.key,
      productId: l.productId,
      unitId: l.unitId,
      quantity: Number(l.quantity),
      priceLevelId: l.isBonus ? undefined : priceLevelId,
      isBonus: l.isBonus,
      isIndent: !!l.isIndent,
      discountType: !l.isBonus && Number(l.discount) > 0 ? 'rupiah' : undefined,
      discountValue: !l.isBonus && Number(l.discount) > 0 ? Number(l.discount) : undefined,
    })), [lines, priceLevelId]);

  const quoteRequest = useMemo(() => ({
    items: payloadItems,
    totalDiscountType: Number(totalDiscount) > 0 ? 'rupiah' : null,
    totalDiscountValue: Number(totalDiscount) || 0,
    shippingFee: Number(shippingFee) || 0,
  }), [payloadItems, totalDiscount, shippingFee]);

  useEffect(() => {
    if (payloadItems.length === 0 || !priceLevelId) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const t = setTimeout(() => {
      api.quoteOrder(quoteRequest)
        .then((d) => { setQuote(d.quote); setQuoteError(null); })
        .catch((err) => { setQuote(null); setQuoteError(err.message); });
    }, 300);
    return () => clearTimeout(t);
  }, [quoteRequest, priceLevelId]);

  // Jumlah bayar default = total tagihan (selama belum diubah manual).
  useEffect(() => {
    if (quote && !payAmountTouched.current) setPayment((p) => ({ ...p, amount: quote.totalDue }));
  }, [quote?.totalDue]);

  const quoteByKey = useMemo(() => {
    const map = {};
    for (const it of quote?.items || []) map[it.clientKey] = it;
    return map;
  }, [quote]);

  const stockShort = lines.some((l) => !l.isIndent && quoteByKey[l.key] && !quoteByKey[l.key].inStock);
  const canSubmit = !submitting && customer && payloadItems.length > 0 && quote && !quoteError && !stockShort
    && (!quote.isBelowCost || belowCostReason.trim());

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const d = await api.createOrder({
        customerId: customer.id,
        invoiceDate,
        dueDate: dueDate || undefined,
        ...quoteRequest,
        shippingMethod: shippingMethod || undefined,
        shippingAddress,
        notes,
        initialPayment: payNow ? {
          paymentMethodId: payment.paymentMethodId,
          amount: Number(payment.amount),
          paymentDate: payment.paymentDate,
        } : undefined,
        belowCostReason: quote.isBelowCost ? belowCostReason : undefined,
      });
      onCreated(d.order);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onCancel && <button className="btn-secondary" onClick={onCancel}>‹ Kembali</button>}
        <h2 style={{ margin: 0 }}>Buat Invoice</h2>
      </div>
      <div style={{ height: 12 }} />
      <Banner type="error" message={error} onClose={() => setError(null)} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <div style={{ gridColumn: 'span 2' }}>
            <label>Pelanggan *</label>
            <CustomerPicker value={customer} onSelect={selectCustomer} />
          </div>
          <div>
            <label>Tanggal invoice</label>
            <input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label>Jatuh tempo (kalau piutang)</label>
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          {priceLevels.length > 1 && (
            <div>
              <label>Level harga</label>
              <select className="input" value={priceLevelId} onChange={(e) => setPriceLevelId(e.target.value)}>
                {priceLevels.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Barang</h3>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
            <ProductSearchSelect key={searchKey} onSelect={addProduct} autoFocus={false} placeholder="Tambah barang — cari nama/kode…" />
          </div>
          {bundles.length > 0 && (
            <select className="input" style={{ flex: '0 1 320px' }} value="" onChange={(e) => addBundle(e.target.value)}>
              <option value="">+ Tambah paket promo…</option>
              {bundles.map((b) => <option key={b.id} value={b.id}>{b.name} — {rupiah(b.price)}</option>)}
            </select>
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th>Barang</th>
              <th style={{ width: 110 }}>Satuan</th>
              <th style={{ width: 80 }}>Qty</th>
              <th style={{ width: 60, textAlign: 'center' }}>Bonus</th>
              <th style={{ width: 60, textAlign: 'center' }} title="Barang belum ada — stok dipotong saat barangnya dikirim">Indent</th>
              <th style={{ width: 120, textAlign: 'right' }}>Harga</th>
              <th style={{ width: 130 }}>Diskon (Rp)</th>
              <th style={{ width: 130, textAlign: 'right' }}>Jumlah</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const q = quoteByKey[l.key];
              if (l.kind === 'bundle') {
                return (
                  <tr key={l.key}>
                    <td>
                      {l.productName} <span className="status-pill" style={{ background: '#ede9fe', color: '#5b21b6', fontSize: 11 }}>Paket</span>
                      {q && (
                        <div style={{ fontSize: 12, color: '#666' }}>
                          Isi: {q.components.map((c, i) => (
                            <span key={i} style={!c.inStock && !l.isIndent ? { color: '#b91c1c' } : undefined}>
                              {i > 0 ? ', ' : ''}{c.productName} ×{Number(c.quantity)}{!c.inStock ? ` (stok ${Number(c.availableQty)})` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>paket</td>
                    <td>
                      <input className="input" type="number" min="1" step="1" style={{ width: '100%', boxSizing: 'border-box' }} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                    </td>
                    <td></td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={!!l.isIndent} onChange={(e) => updateLine(l.key, { isIndent: e.target.checked })} title="Paket indent — stok isinya dipotong saat dikirim" />
                    </td>
                    <td style={{ textAlign: 'right' }}>{q ? rupiah(q.price) : '…'}</td>
                    <td></td>
                    <td style={{ textAlign: 'right' }}>{q ? rupiah(q.subtotal) : '…'}</td>
                    <td><button type="button" onClick={() => removeLine(l.key)} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 16 }} title="Hapus baris">×</button></td>
                  </tr>
                );
              }
              return (
                <tr key={l.key}>
                  <td>
                    {l.productName}
                    {l.sku && <span style={{ color: '#999', fontSize: 12 }}> · {l.sku}</span>}
                    {q && !q.inStock && !l.isIndent && <div style={{ color: '#b91c1c', fontSize: 12 }}>Stok kurang (tersedia {Number(q.availableQty)}) — centang Indent kalau barang menyusul</div>}
                    {l.isIndent && <div style={{ color: '#7c3aed', fontSize: 12 }}>Indent — stok dipotong saat dikirim</div>}
                    {q && q.isBelowCost && <div style={{ color: '#b45309', fontSize: 12 }}>Di bawah HPP</div>}
                  </td>
                  <td>
                    <select className="input" value={l.unitId} onChange={(e) => updateLine(l.key, { unitId: e.target.value })} style={{ width: '100%' }}>
                      {l.units.map((u) => <option key={u.unit_id} value={u.unit_id}>{u.unit_name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="input" type="number" min="0" step="any" style={{ width: '100%', boxSizing: 'border-box' }} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={l.isBonus} onChange={(e) => updateLine(l.key, { isBonus: e.target.checked, discount: '' })} title="Barang gratis — harga 0, dicatat sebagai beban promosi" />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={!!l.isIndent} onChange={(e) => updateLine(l.key, { isIndent: e.target.checked })} title="Barang belum ada — stok dipotong saat barangnya dikirim" />
                  </td>
                  <td style={{ textAlign: 'right' }}>{l.isBonus ? 'GRATIS' : q ? rupiah(q.price) : '…'}</td>
                  <td>
                    {!l.isBonus && <MoneyInput value={l.discount} onChange={(v) => updateLine(l.key, { discount: v })} placeholder="0" style={{ width: '100%', boxSizing: 'border-box' }} />}
                  </td>
                  <td style={{ textAlign: 'right' }}>{l.isBonus ? '-' : q ? rupiah(q.subtotal) : '…'}</td>
                  <td><button type="button" onClick={() => removeLine(l.key)} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 16 }} title="Hapus baris">×</button></td>
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#999', padding: 20 }}>Belum ada barang — cari di kotak atas</td></tr>}
          </tbody>
        </table>
        {quoteError && <div className="error-banner" style={{ marginTop: 12 }}>{quoteError}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Pengiriman & catatan</h3>
          <div className="form-grid">
            <div>
              <label>Cara kirim</label>
              <input className="input" list="shipping-methods" value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)} placeholder="JNT / JNE / KC / Ambil sendiri…" />
              <datalist id="shipping-methods">{shippingMethods.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            <div>
              <label>Ongkir (ditagih ke pembeli)</label>
              <MoneyInput value={shippingFee} onChange={setShippingFee} placeholder="0" />
              {isPickup(shippingMethod) && Number(shippingFee) > 0 && <div style={{ fontSize: 12, color: '#b45309' }}>Diambil sendiri tapi ada ongkir?</div>}
            </div>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div>
              <label>Alamat kirim</label>
              <textarea className="input" style={{ minHeight: 64, fontFamily: 'inherit' }} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} placeholder={customer ? '' : 'Pilih pelanggan dulu — alamat terisi otomatis'} />
            </div>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div>
              <label>Catatan di invoice</label>
              <textarea className="input" style={{ minHeight: 48, fontFamily: 'inherit' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. FREE konsultasi" />
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Total</h3>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div>
              <label>Diskon total (Rp)</label>
              <MoneyInput value={totalDiscount} onChange={setTotalDiscount} placeholder="0" />
            </div>
          </div>
          <table>
            <tbody>
              <tr><td>Subtotal barang</td><td style={{ textAlign: 'right' }}>{quote ? rupiah(quote.subtotal) : '-'}</td></tr>
              {quote && Number(quote.discountTotal) > 0 && <tr><td>Diskon</td><td style={{ textAlign: 'right' }}>-{rupiah(quote.discountTotal)}</td></tr>}
              {quote && quote.ppnEnabled && <tr><td>PPN {Number(quote.ppnRate)}%{quote.ppnMode === 'included' ? ' (termasuk)' : ''}</td><td style={{ textAlign: 'right' }}>{rupiah(quote.ppnAmount)}</td></tr>}
              <tr><td>Ongkir</td><td style={{ textAlign: 'right' }}>{rupiah(shippingFee || 0)}</td></tr>
              <tr style={{ fontSize: 18, fontWeight: 700 }}><td>Total tagihan</td><td style={{ textAlign: 'right' }}>{quote ? rupiah(quote.totalDue) : '-'}</td></tr>
              {quote && Number(quote.bvTotal) > 0 && <tr><td style={{ color: '#666' }}>Total BV</td><td style={{ textAlign: 'right', color: '#666' }}>{Number(quote.bvTotal)}</td></tr>}
            </tbody>
          </table>

          {quote?.isBelowCost && (
            <div style={{ marginTop: 12, padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 13 }}>
              <div style={{ marginBottom: 6 }}>{quote.belowCostMessage}</div>
              <label style={{ fontWeight: 600 }}>Alasan jual di bawah HPP (khusus Owner)</label>
              <input className="input" style={{ width: '100%', boxSizing: 'border-box', marginTop: 4 }} value={belowCostReason} onChange={(e) => setBelowCostReason(e.target.value)} />
            </div>
          )}

          <div style={{ borderTop: '1px solid #eee', marginTop: 14, paddingTop: 12 }}>
            <label style={{ fontWeight: 600, fontSize: 14 }}>
              <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} /> Pembayaran sudah diterima
            </label>
            {payNow && (
              <div className="form-grid" style={{ marginTop: 10 }}>
                <div>
                  <label>Metode</label>
                  <select className="input" value={payment.paymentMethodId} onChange={(e) => setPayment({ ...payment, paymentMethodId: e.target.value })}>
                    {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label>Jumlah</label>
                  <MoneyInput value={payment.amount} onChange={(v) => { payAmountTouched.current = true; setPayment({ ...payment, amount: v }); }} />
                </div>
                <div>
                  <label>Tanggal bayar</label>
                  <input className="input" type="date" value={payment.paymentDate} onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} />
                </div>
              </div>
            )}
          </div>

          <button className="btn-primary" style={{ marginTop: 16, width: '100%', padding: 12, fontSize: 15 }} disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Menyimpan…' : 'Simpan Invoice'}
          </button>
          {!customer && <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Pilih pelanggan dulu.</div>}
          {stockShort && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>Ada barang yang stoknya kurang — kurangi qty atau centang Indent.</div>}
        </div>
      </div>
    </div>
  );
}
