import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { uploadSingle } from '../middleware/upload';
import {
  listContracts,
  getContract,
  extractFromInput,
  generateContract,
  saveSignature,
  createSigningLink,
  getContractStatus,
  deleteContract,
} from '../controllers/contract.controller';

const router = Router();

// All contract routes require authentication
router.use(authenticate);

/**
 * GET /api/contracts
 * List all contracts for the current user.
 */
router.get('/', listContracts);

/**
 * GET /api/contracts/:id
 * Get a single contract by ID.
 */
router.get('/:id', getContract);

/**
 * GET /api/contracts/:id/status
 * Lightweight status polling endpoint.
 */
router.get('/:id/status', getContractStatus);

/**
 * POST /api/contracts/extract
 * Extract contract fields from text or an uploaded image/PDF.
 * Accepts multipart/form-data (method + file) or JSON (method + text).
 */
router.post('/extract', uploadSingle, extractFromInput);

/**
 * POST /api/contracts/:id/generate
 * Generate (or re-generate) the contract PDF.
 * Body: { title?, type?, fields? }
 */
router.post('/:id/generate', generateContract);

/**
 * POST /api/contracts/:id/sign
 * Save the sender's signature and embed it in the PDF.
 * Body: { signature: string } — base64 data URL
 */
router.post('/:id/sign', saveSignature);

/**
 * POST /api/contracts/:id/send
 * Create a signing link and mark the contract as SENT.
 * Body: { otherPartyEmail, otherPartyName, expiresInDays? }
 */
router.post('/:id/send', createSigningLink);

/**
 * DELETE /api/contracts/:id
 * Delete a contract and all associated storage files.
 */
router.delete('/:id', deleteContract);

export default router;
