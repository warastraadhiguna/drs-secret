import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import ProductSearchSelect from '../components/ProductSearchSelect.jsx';
import { rupiah, qty } from '../utils/format.js';

const emptyForm = { id: null, code: '', name: '', price: '', bvPoints: '', notes: '', items: [] };
let compSeq = 0;

// Master Paket Promo — paket dijual sbg 1 baris di invoice, stok tiap isinya
// dipotong. Harga normal & HPP isi paket ditampilkan sbg acuan menetapkan
// harga paket.
export default function BundlesScreen() {
  const [bundles, setBundles] = useState([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [form, setForm] = useState(null);
  const [searchKey, setSearchKey] = useState(0);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [saving, setSaving] = useState(false);

  function reload() {
    api.listBundles({ includeInactive }).then((d) => setBundles(d.bundles)).catch((err) => setError(err.message));
  }
  useEffect(reload, [includeInactive]);

  function startNew() {
    setForm({ ...emptyForm, items: [] });
  }

  async function startEdit(b) {
    const items = [];
    for (const it of b.items) {
      // Ambil daftar satuan produk supaya satuan bisa diganti di form.
      let units = [{ unit_id: it.unitId, unit_name: it.unitName }];
      try {
        const d = await api.getProductForSale(it.productId);
        units = d.units;
      } catch {
        // produk nonaktif — tetap tampilkan satuan yang tersimpan
      }
      compSeq += 1;
      items.push({ key: `c${compSeq}`, productId: it.productId, productName: it.productName, units, unitId: it.unitId, quantity: String(Number(it.quantity)) });
    }
    setForm({
      id: b.id,
      code: b.code || '',
      name: b.name,
      price: b.price,
      bvPoints: b.bvPoints === null ? '' : String(Number(b.bvPoints)),
      notes: b.notes || '',
      items,
      reference: b,
    });
  }

  async function addComponent(product) {
    if (!product) return;
    try {
      const d = await api.getProductForSale(product.id);
      compSeq += 1;
      setForm((f) => ({
        ...f,
        items: [...f.items, { key: `c${compSeq}`, productId: d.product.id, productName: d.product.name, units: d.units, unitId: d.matchedUnit.unit_id, quantity: '1' }],
      }));
      setSearchKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  function updateComp(key, patch) {
    setForm((f) => ({ ...f, items: f.items.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  }
  function removeComp(key) {
    setForm((f) => ({ ...f, items: f.items.filter((c) => c.key !== key) }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      code: form.code,
      name: form.name,
      price: form.price === '' ? null : Number(form.price),
      bvPoints: form.bvPoints === '' ? null : Number(form.bvPoints),
      notes: form.notes,
      items: form.items.map((c) => ({ productId: c.productId, unitId: c.unitId, quantity: Number(c.quantity) })),
    };
    try {
      if (form.id) await api.updateBundle(form.id, payload);
      else await api.createBundle(payload);
      setInfo(form.id ? 'Paket disimpan' : 'Paket ditambahkan');
      setForm(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(b) {
    try {
      await api.updateBundle(b.id, { isActive: !b.isActive });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  if (form) {
    const ref = form.reference;
    return (
      <div>
        <button className="btn-secondary" onClick={() => setForm(null)} style={{ marginBottom: 12 }}>‹ Kembali</button>
        <h2 style={{ marginTop: 0 }}>{form.id ? `Ubah paket: ${form.name}` : 'Paket promo baru'}</h2>
        <Banner type="error" message={error} onClose={() => setError(null)} />
        <form onSubmit={save}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="form-grid">
              <div style={{ gridColumn: 'span 2' }}><label>Nama paket *</label><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Promo Twin #7 + #5" /></div>
              <div><label>Kode (opsional)</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              <div><label>Harga paket *</label><MoneyInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} /></div>
              <div>
                <label>Poin BV paket</label>
                <input className="input" type="number" min="0" step="0.01" value={form.bvPoints} onChange={(e) => setForm({ ...form, bvPoints: e.target.value })} placeholder="kosong = jumlah BV isinya" />
              </div>
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div><label>Catatan</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="mis. berlaku s/d akhir Desember" /></div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Isi paket (per 1 paket)</h3>
            <div style={{ maxWidth: 480, marginBottom: 12 }}>
              <ProductSearchSelect key={searchKey} onSelect={addComponent} autoFocus={false} placeholder="Tambah isi — cari produk…" />
            </div>
            <table>
              <thead><tr><th>Produk</th><th style={{ width: 140 }}>Satuan</th><th style={{ width: 100 }}>Qty</th><th style={{ width: 30 }}></th></tr></thead>
              <tbody>
                {form.items.map((c) => (
                  <tr key={c.key}>
                    <td>{c.productName}</td>
                    <td>
                      <select className="input" style={{ width: '100%' }} value={c.unitId} onChange={(e) => updateComp(c.key, { unitId: e.target.value })}>
                        {c.units.map((u) => <option key={u.unit_id} value={u.unit_id}>{u.unit_name}</option>)}
                      </select>
                    </td>
                    <td><input className="input" type="number" min="0" step="any" style={{ width: '100%', boxSizing: 'border-box' }} value={c.quantity} onChange={(e) => updateComp(c.key, { quantity: e.target.value })} /></td>
                    <td><button type="button" onClick={() => removeComp(c.key)} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 16 }}>×</button></td>
                  </tr>
                ))}
                {form.items.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#999', padding: 16 }}>Belum ada isi</td></tr>}
              </tbody>
            </table>
            {ref && (
              <p style={{ fontSize: 13, color: '#555', marginBottom: 0 }}>
                Acuan (isi tersimpan): harga normal {rupiah(ref.normalTotal)}{ref.missingNormalPrice ? ' (sebagian isi belum punya harga jual)' : ''} · total HPP {rupiah(ref.costTotal)}
              </p>
            )}
            <p style={{ fontSize: 12, color: '#888' }}>
              Di invoice, harga paket dibagi ke tiap isi sebanding harga normalnya — dipakai untuk laporan per produk & retur.
              Barang "free" di dalam paket cukup dimasukkan sebagai isi biasa.
            </p>
          </div>

          <button className="btn-primary" type="submit" disabled={saving || !form.name.trim() || form.price === '' || form.items.length === 0}>
            {saving ? 'Menyimpan…' : 'Simpan paket'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h2>Paket Promo</h2>
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <Banner type="success" message={info} onClose={() => setInfo(null)} />
      <div className="inline-form">
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Tampilkan nonaktif
        </label>
        <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={startNew}>+ Paket baru</button>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Paket</th><th>Isi</th>
              <th style={{ textAlign: 'right' }}>Harga paket</th>
              <th style={{ textAlign: 'right' }}>Harga normal</th>
              <th style={{ textAlign: 'right' }}>HPP</th>
              <th style={{ textAlign: 'right' }}>BV</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b) => {
              const belowCost = Number(b.price) < Number(b.costTotal);
              return (
                <tr key={b.id} style={!b.isActive ? { color: '#999' } : undefined}>
                  <td>
                    <strong>{b.name}</strong>{b.code ? <span style={{ color: '#888' }}> · {b.code}</span> : null}
                    {!b.isActive && <span className="badge inactive" style={{ marginLeft: 6 }}>Nonaktif</span>}
                    {b.notes && <div style={{ fontSize: 12, color: '#666' }}>{b.notes}</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>{b.items.map((i) => `${i.productName} ×${qty(i.quantity)}${i.unitName !== 'pcs' ? ` ${i.unitName}` : ''}`).join(', ')}</td>
                  <td style={{ textAlign: 'right' }}>{rupiah(b.price)}</td>
                  <td style={{ textAlign: 'right' }}>{rupiah(b.normalTotal)}{b.missingNormalPrice ? '*' : ''}</td>
                  <td style={{ textAlign: 'right', color: belowCost ? '#b91c1c' : undefined }} title={belowCost ? 'Harga paket di bawah HPP' : undefined}>{rupiah(b.costTotal)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(b.effectiveBv)}{b.bvPoints === null ? '' : ' (tetap)'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-secondary" onClick={() => startEdit(b)} style={{ marginRight: 6 }}>Ubah</button>
                    <button className="btn-secondary" onClick={() => toggleActive(b)}>{b.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  </td>
                </tr>
              );
            })}
            {bundles.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: 20 }}>Belum ada paket promo</td></tr>}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 0 }}>* sebagian isi belum punya harga jual normal.</p>
      </div>
    </div>
  );
}
