// Format tampilan uang/tanggal — dipakai modul Invoice/Pesanan & Pelanggan.
export function rupiah(value) {
  const n = Number(value || 0);
  return `Rp${n.toLocaleString('id-ID')}`;
}

// Qty DECIMAL dari server ("2.0000") -> "2", "1.5000" -> "1,5".
export function qty(value) {
  const n = Number(value || 0);
  return n.toLocaleString('id-ID', { maximumFractionDigits: 4 });
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// 'YYYY-MM-DD' (atau ISO datetime) -> "12 November 2026"
export function longDate(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(value);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// 'YYYY-MM-DD' -> "12/11/2026"
export function shortDate(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function dateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function todayStr() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const PAYMENT_STATUS_LABEL = { unpaid: 'Belum bayar', partial: 'Bayar sebagian', paid: 'Lunas' };
export const SHIPPING_STATUS_LABEL = { pending: 'Belum dikirim', shipped: 'Dikirim' };

export function paymentBadgeStyle(status) {
  if (status === 'paid') return { background: '#dcfce7', color: '#166534' };
  if (status === 'partial') return { background: '#fef3c7', color: '#92400e' };
  return { background: '#fee2e2', color: '#991b1b' };
}

export function shippingBadgeStyle(status) {
  return status === 'shipped' ? { background: '#dbeafe', color: '#1e40af' } : { background: '#f3f4f6', color: '#4b5563' };
}

export function isPickup(method) {
  return /ambil/i.test(method || '');
}

// Baris invoice utk ditampilkan/dicetak: baris-baris isi paket promo (bundleGroup
// sama) digabung jadi 1 baris paket, isinya di `components`.
export function groupInvoiceLines(items) {
  const result = [];
  const byGroup = {};
  for (const it of items) {
    if (!it.bundleGroup) {
      result.push({ key: it.id, kind: 'item', itemIds: [it.id], isIndent: it.fulfillmentStatus === 'pending', ...it });
      continue;
    }
    let line = byGroup[it.bundleGroup];
    if (!line) {
      line = {
        key: it.bundleGroup,
        kind: 'bundle',
        productName: it.bundleName,
        quantity: it.bundleQty,
        unitName: 'paket',
        sellingPrice: it.bundlePrice,
        discountAmount: '0',
        subtotal: 0,
        bvPoints: 0,
        isBonus: false,
        isIndent: false,
        itemIds: [],
        components: [],
      };
      byGroup[it.bundleGroup] = line;
      result.push(line);
    }
    line.subtotal += Number(it.subtotal);
    line.itemIds.push(it.id);
    if (it.fulfillmentStatus === 'pending') line.isIndent = true;
    line.bvPoints += Number(it.bvPoints || 0);
    line.components.push({ productName: it.productName, quantity: it.quantity, unitName: it.unitName });
  }
  for (const line of Object.values(byGroup)) line.subtotal = String(line.subtotal);
  return result;
}

export function componentsText(components) {
  return components.map((c) => `${c.productName} ×${qty(c.quantity)}`).join(', ');
}
