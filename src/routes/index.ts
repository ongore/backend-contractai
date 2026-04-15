import { Router } from 'express';
import authRoutes from './auth.routes';
import contractRoutes from './contract.routes';
import signRoutes from './sign.routes';

const router = Router();

// Health check — no auth required
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
    },
  });
});

// Route groups
router.use('/auth', authRoutes);
router.use('/contracts', contractRoutes);
router.use('/sign', signRoutes);

export default router;
