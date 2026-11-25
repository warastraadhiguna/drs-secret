const express = require('express');
const BundleService = require('../services/BundleService');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// GET /api/admin/bundles?includeInactive=1
// Juga dipakai layar Buat Invoice (daftar paket aktif) — cukup izin orders.create
// ATAU bundles.view; di sini pakai bundles.view (admin punya keduanya).
router.get(
  '/',
  requirePermission('bundles', 'view'),
  asyncHandler(async (req, res) => {
    const bundles = await BundleService.listBundles({ includeInactive: req.query.includeInactive === '1' });
    res.json({ bundles });
  })
);

router.get(
  '/:id',
  requirePermission('bundles', 'view'),
  asyncHandler(async (req, res) => {
    const bundle = await BundleService.getBundle(req.params.id);
    res.json({ bundle });
  })
);

// POST /api/admin/bundles — { code?, name, price, bvPoints?, notes?, items: [{ productId, unitId, quantity }] }
router.post(
  '/',
  requirePermission('bundles', 'create'),
  asyncHandler(async (req, res) => {
    const bundle = await BundleService.createBundle(req.body);
    res.status(201).json({ bundle });
  })
);

// PUT /api/admin/bundles/:id — partial, items (kalau dikirim) mengganti isi paket
router.put(
  '/:id',
  requirePermission('bundles', 'edit'),
  asyncHandler(async (req, res) => {
    const bundle = await BundleService.updateBundle(req.params.id, req.body);
    res.json({ bundle });
  })
);

module.exports = router;
