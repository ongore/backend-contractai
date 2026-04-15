import { Router } from 'express';
import { getContractForSigning, submitSignature } from '../controllers/sign.controller';

const router = Router();

/**
 * GET /api/sign/:token
 * Public route — no authentication required.
 * Returns contract preview for the recipient to review.
 */
router.get('/:token', getContractForSigning);

/**
 * POST /api/sign/:token
 * Public route — no authentication required.
 * Accepts the recipient's signature and completes the contract.
 * Body: { signature: string, signerName?: string }
 */
router.post('/:token', submitSignature);

export default router;
