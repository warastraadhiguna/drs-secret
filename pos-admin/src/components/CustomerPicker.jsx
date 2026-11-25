import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Pilih pelanggan utk invoice: cari (nama/telepon/kota) ATAU tambah baru di
// tempat tanpa pindah layar. onSelect(customer|null).
export default function CustomerPicker({ value, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', city: '', address: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.listCustomers({ q: query.trim(), limit: 15 })
        .then((d) => { setResults(d.customers); setHighlight(0); })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  function pick(c) {
    setOpen(false);
    setQuery('');
    onSelect(c);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[highlight]) pick(results[highlight]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  function startAdd() {
    setForm({ name: query.trim(), phone: '', city: '', address: '' });
    setAdding(true);
    setOpen(false);
    setError(null);
  }

  async function saveNew() {
    if (!form.name.trim()) { setError('Nama wajib diisi'); return; }
    setSaving(true);
    try {
      const d = await api.createCustomer(form);
      setAdding(false);
      pick(d.customer);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (value) {
    return (
      <div className="input" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', background: '#f9fafb' }}>
        <div>
          <strong>{value.name}</strong>{value.city ? ` — ${value.city}` : ''}
          {value.phone && <div style={{ fontSize: 12, color: '#666' }}>{value.phone}</div>}
        </div>
        <button type="button" onClick={() => onSelect(null)} style={{ background: 'none', border: 'none', color: '#4f46e5', cursor: 'pointer', fontSize: 12, padding: 0 }}>
          Ganti
        </button>
      </div>
    );
  }

  if (adding) {
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fafafa' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Pelanggan baru</div>
        {error && <div className="error-banner" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="form-grid">
          <div><label>Nama *</label><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>Telepon/WA</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label>Kota</label><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>Alamat kirim</label>
          <textarea className="input" style={{ width: '100%', boxSizing: 'border-box', minHeight: 54, fontFamily: 'inherit' }} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button type="button" className="btn-primary" onClick={saveNew} disabled={saving}>Simpan & pilih</button>
          <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Batal</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        style={{ width: '100%', boxSizing: 'border-box' }}
        placeholder="Cari pelanggan (nama / telepon / kota)…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #ddd',
          borderRadius: 6, marginTop: 2, maxHeight: 260, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        }}>
          {results.map((c, idx) => (
            <div
              key={c.id}
              onMouseDown={() => pick(c)}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, background: idx === highlight ? '#eef2ff' : '#fff' }}
            >
              <strong>{c.name}</strong>{c.city ? ` — ${c.city}` : ''}{c.phone ? <span style={{ color: '#888' }}> · {c.phone}</span> : null}
            </div>
          ))}
          {query.trim() && results.length === 0 && <div style={{ padding: 8, color: '#999', fontSize: 13 }}>Tidak ada yang cocok</div>}
          <div onMouseDown={startAdd} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, color: '#4f46e5', borderTop: '1px solid #eee' }}>
            + Tambah pelanggan baru{query.trim() ? ` "${query.trim()}"` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
