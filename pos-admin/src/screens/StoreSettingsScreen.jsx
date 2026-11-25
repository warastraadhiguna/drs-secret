import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Banner from '../components/Banner.jsx';

const labelStyle = { fontSize: 13, fontWeight: 600 };
const fieldStyle = { width: '100%', margin: '6px 0 14px', boxSizing: 'border-box' };

export default function StoreSettingsScreen() {
  const [settings, setSettings] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [addressDraft, setAddressDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [taxModeDraft, setTaxModeDraft] = useState('non_pkp');
  const [invoiceDraft, setInvoiceDraft] = useState({ nextInvoiceNumber: '', bankInfo: '', signerName: '', footerNote: '' });
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  function applySettings(s) {
    setSettings(s);
    setNameDraft(s.store_name || '');
    setAddressDraft(s.store_address || '');
    setPhoneDraft(s.store_phone || '');
    setTaxModeDraft(s.tax_mode || 'non_pkp');
    setInvoiceDraft({
      nextInvoiceNumber: String(s.next_invoice_number || ''),
      bankInfo: s.invoice_bank_info || '',
      signerName: s.invoice_signer_name || '',
      footerNote: s.invoice_footer_note || '',
    });
  }

  function reload() {
    api.getStoreSettings().then((d) => applySettings(d.settings)).catch((err) => setError(err.message));
  }

  useEffect(reload, []);

  async function saveIdentity(e) {
    e.preventDefault();
    if (!nameDraft.trim()) {
      setError('Nama toko wajib diisi');
      return;
    }
    try {
      const d = await api.updateStoreSettings({
        storeName: nameDraft.trim(),
        storeAddress: addressDraft.trim() || null,
        storePhone: phoneDraft.trim() || null,
      });
      applySettings(d.settings);
      setError(null);
      setInfo('Identitas toko disimpan — dipakai di kop invoice berikutnya yang dicetak');
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveInvoice(e) {
    e.preventDefault();
    try {
      const d = await api.updateInvoiceSettings({
        nextInvoiceNumber: invoiceDraft.nextInvoiceNumber === '' ? undefined : Number(invoiceDraft.nextInvoiceNumber),
        bankInfo: invoiceDraft.bankInfo,
        signerName: invoiceDraft.signerName,
        footerNote: invoiceDraft.footerNote,
      });
      applySettings(d.settings);
      setError(null);
      setInfo('Pengaturan invoice disimpan');
    } catch (err) {
      setError(err.message);
    }
  }

  function onLogoFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Logo harus file PNG atau JPEG');
      return;
    }
    if (file.size > 1024 * 1024) {
      setError('Ukuran logo maksimal 1 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const d = await api.updateInvoiceSettings({ logo: reader.result });
        applySettings(d.settings);
        setError(null);
        setInfo('Logo invoice disimpan');
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeLogo() {
    try {
      const d = await api.updateInvoiceSettings({ logo: null });
      applySettings(d.settings);
      setInfo('Logo invoice dihapus');
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveTaxMode(e) {
    e.preventDefault();
    try {
      const d = await api.updateStoreSettings({ taxMode: taxModeDraft });
      applySettings(d.settings);
      setError(null);
      setInfo(`Mode pajak disimpan: ${d.settings.tax_mode === 'pkp' ? 'PKP' : 'Non-PKP'}`);
    } catch (err) {
      setTaxModeDraft(settings.tax_mode); // gagal (mis. terkunci) -> balikin draft ke nilai tersimpan
      setError(err.message);
    }
  }

  return (
    <div>
      <h2>Pengaturan Toko</h2>
      <p style={{ color: '#666', marginTop: -8 }}>Identitas toko, tampilan invoice, dan status pajak.</p>
      <Banner type="error" message={error} onClose={() => setError(null)} />
      <Banner type="success" message={info} onClose={() => setInfo(null)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Identitas Toko</h3>
          <p style={{ color: '#666', fontSize: 13 }}>Tampil di kop invoice.</p>
          <form onSubmit={saveIdentity}>
            <label style={labelStyle}>Nama Toko</label>
            <input className="input" style={fieldStyle} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
            <label style={labelStyle}>Alamat</label>
            <input className="input" style={fieldStyle} value={addressDraft} onChange={(e) => setAddressDraft(e.target.value)} />
            <label style={labelStyle}>No. HP/Telepon/WA</label>
            <input className="input" style={fieldStyle} value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} placeholder="(opsional)" />
            <button className="btn-primary" type="submit">Simpan Identitas Toko</button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Invoice</h3>
          <form onSubmit={saveInvoice}>
            <label style={labelStyle}>Nomor invoice berikutnya</label>
            <input
              className="input"
              style={fieldStyle}
              type="number"
              min="1"
              value={invoiceDraft.nextInvoiceNumber}
              onChange={(e) => setInvoiceDraft({ ...invoiceDraft, nextInvoiceNumber: e.target.value })}
            />
            <label style={labelStyle}>Rekening transfer (boleh beberapa baris)</label>
            <textarea
              className="input"
              style={{ ...fieldStyle, minHeight: 64, fontFamily: 'inherit' }}
              value={invoiceDraft.bankInfo}
              onChange={(e) => setInvoiceDraft({ ...invoiceDraft, bankInfo: e.target.value })}
              placeholder={'BCA 017.021.2100\na.n. Elsje Yoshida'}
            />
            <label style={labelStyle}>Nama penanda tangan</label>
            <input
              className="input"
              style={fieldStyle}
              value={invoiceDraft.signerName}
              onChange={(e) => setInvoiceDraft({ ...invoiceDraft, signerName: e.target.value })}
            />
            <label style={labelStyle}>Catatan kaki (opsional)</label>
            <textarea
              className="input"
              style={{ ...fieldStyle, minHeight: 48, fontFamily: 'inherit' }}
              value={invoiceDraft.footerNote}
              onChange={(e) => setInvoiceDraft({ ...invoiceDraft, footerNote: e.target.value })}
              placeholder="mis. Terima kasih atas kepercayaan Anda"
            />
            <button className="btn-primary" type="submit">Simpan Pengaturan Invoice</button>
          </form>

          <div style={{ borderTop: '1px solid #eee', marginTop: 18, paddingTop: 14 }}>
            <label style={labelStyle}>Logo invoice</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {settings?.invoice_logo ? (
                <img src={settings.invoice_logo} alt="Logo" style={{ maxHeight: 64, maxWidth: 160, border: '1px solid #eee', borderRadius: 4 }} />
              ) : (
                <span style={{ color: '#999', fontSize: 13 }}>Belum ada logo</span>
              )}
              <label className="btn-secondary" style={{ display: 'inline-block' }}>
                Pilih gambar…
                <input type="file" accept="image/png,image/jpeg" onChange={onLogoFile} style={{ display: 'none' }} />
              </label>
              {settings?.invoice_logo && <button type="button" className="btn-secondary" onClick={removeLogo}>Hapus logo</button>}
            </div>
            <p style={{ fontSize: 12, color: '#888' }}>PNG/JPEG, maks 1 MB.</p>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Mode Pajak</h3>
          <p style={{ color: '#666', fontSize: 13 }}>
            <strong>Non-PKP</strong>: invoice tanpa PPN. PPN yang dibayar ke BWL saat pembelian ikut jadi HPP.{' '}
            <strong>PKP</strong>: PPN Keluaran ditambahkan di invoice (tarif & mode termasuk/belum termasuk diatur di
            halaman <em>Level Harga</em>), PPN Masukan pembelian dicatat terpisah. Mode hanya bisa diganti kalau bulan
            berjalan belum ada transaksi penjualan/pembelian.
          </p>
          {settings && (
            <form onSubmit={saveTaxMode}>
              <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
                  <input type="radio" name="taxMode" value="non_pkp" checked={taxModeDraft === 'non_pkp'} onChange={(e) => setTaxModeDraft(e.target.value)} />
                  Non-PKP
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
                  <input type="radio" name="taxMode" value="pkp" checked={taxModeDraft === 'pkp'} onChange={(e) => setTaxModeDraft(e.target.value)} />
                  PKP
                </label>
              </div>
              <button className="btn-primary" type="submit" disabled={taxModeDraft === settings.tax_mode}>Simpan Mode Pajak</button>
              <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                Status saat ini: <strong>{settings.tax_mode === 'pkp' ? 'PKP' : 'Non-PKP'}</strong>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
