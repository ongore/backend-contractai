import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { extractContractFields } from '../services/ai/extractService';
import { generateContractPdf, embedSignatureInPdf, ContractData } from '../services/pdf/pdfService';
import { uploadPdf, uploadSignature, deleteContractFiles } from '../services/storage/storageService';
import { createSigningToken, getSigningLink, getTokenExpiry } from '../services/signing/signingService';
import { success, created, noContent } from '../utils/response';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  AppError,
} from '../utils/errors';
import logger from '../utils/logger';
import { ContractStatus, ContractType } from '@prisma/client';
import { ExtractedField } from '../services/ai/extractService';

// ─── Validation Schemas ────────────────────────────────────────────────────────

const generateContractSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z
    .enum([
      'SERVICE_AGREEMENT',
      'FREELANCE_AGREEMENT',
      'PAYMENT_AGREEMENT',
      'GENERAL_AGREEMENT',
    ])
    .optional(),
  fields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.string(),
        required: z.boolean(),
      })
    )
    .optional(),
});

const signContractSchema = z.object({
  signature: z.string().min(10, 'Signature data is required'), // base64
});

const sendContractSchema = z.object({
  otherPartyEmail: z.string().email('Invalid email address').optional(),
  otherPartyName: z.string().optional(),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function assertContractOwnership(
  contractId: string,
  userId: string
) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
  });

  if (!contract) throw new NotFoundError('Contract');
  if (contract.userId !== userId) throw new ForbiddenError('You do not have access to this contract');

  return contract;
}

function toContractData(contract: {
  id: string;
  title: string;
  type: ContractType;
  extractedFields: unknown;
  mySignature: string | null;
  otherPartySignature: string | null;
  otherPartyName: string | null;
  otherPartyEmail: string | null;
  createdAt: Date;
}): ContractData {
  return {
    id: contract.id,
    title: contract.title,
    type: contract.type as ContractData['type'],
    extractedFields: (contract.extractedFields as unknown as ExtractedField[]) ?? [],
    mySignature: contract.mySignature,
    otherPartySignature: contract.otherPartySignature,
    otherPartyName: contract.otherPartyName,
    otherPartyEmail: contract.otherPartyEmail,
    createdAt: contract.createdAt,
  };
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/contracts
 */
export async function listContracts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const contracts = await prisma.contract.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        otherPartyName: true,
        otherPartyEmail: true,
        pdfUrl: true,
        createdAt: true,
        updatedAt: true,
        signedByMeAt: true,
        sentAt: true,
        signedByOtherAt: true,
        completedAt: true,
      },
    });

    success(res, contracts);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/contracts/:id
 */
export async function getContract(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const contract = await assertContractOwnership(req.params.id, req.user.id);
    success(res, contract);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contracts/extract
 * Accepts multipart/form-data with:
 *   - method: 'text' | 'image' | 'pdf'
 *   - text: string (for text method)
 *   - file: File (for image/pdf method)
 *
 * Or application/json with { method: 'text', text: '...' }
 */
export async function extractFromInput(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user.id;

    const method = (req.body?.method as string) ?? (req.file ? 'image' : 'text');
    const text = req.body?.text as string | undefined;
    const file = req.file;

    if (!method) {
      throw new ValidationError('Field "method" is required: text | image | pdf');
    }

    if (method === 'text' && !text?.trim()) {
      throw new ValidationError('Field "text" is required when method is "text"');
    }

    if ((method === 'image' || method === 'pdf') && !file) {
      throw new ValidationError('A file upload is required when method is "image" or "pdf"');
    }

    logger.info('Starting contract extraction', { userId, method });

    const result = await extractContractFields({
      method: method as 'text' | 'image' | 'pdf',
      text,
      imageBuffer: file?.buffer,
      mimeType: file?.mimetype,
    });

    // Ensure user exists in DB (auto-sync for first use)
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email: req.user.email },
      update: {},
    });

    // Create contract record with extracted fields
    const contract = await prisma.contract.create({
      data: {
        userId,
        title: result.suggestedTitle,
        type: result.suggestedContractType,
        status: 'DRAFT',
        extractedFields: result.fields as unknown as never,
        rawInput: method === 'text' ? text : null,
        inputMethod: method,
      },
    });

    logger.info('Contract created from extraction', {
      contractId: contract.id,
      userId,
      fieldCount: result.fields.length,
      type: result.suggestedContractType,
    });

    created(res, {
      ...contract,
      extractedFields: result.fields,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contracts/:id/generate
 * Validates fields, generates PDF, uploads to storage.
 */
export async function generateContract(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user.id;
    const contractId = req.params.id;

    const parsed = generateContractSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const existing = await assertContractOwnership(contractId, userId);

    // Merge incoming field updates with existing
    const updatedFields = parsed.data.fields ?? (existing.extractedFields as unknown as ExtractedField[]) ?? [];
    const updatedType = (parsed.data.type ?? existing.type) as ContractType;
    const updatedTitle = parsed.data.title ?? existing.title;

    // Build contract data for PDF
    const contractData: ContractData = toContractData({
      ...existing,
      title: updatedTitle,
      type: updatedType,
      extractedFields: updatedFields,
    });

    logger.info('Generating PDF for contract', { contractId, userId });

    const pdfBuffer = await generateContractPdf(contractData);
    const { url: pdfUrl, path: pdfStoragePath } = await uploadPdf(userId, contractId, pdfBuffer);

    const updated = await prisma.contract.update({
      where: { id: contractId },
      data: {
        title: updatedTitle,
        type: updatedType,
        extractedFields: updatedFields as unknown as never,
        pdfUrl,
        pdfStoragePath,
        status: ContractStatus.GENERATED,
      },
    });

    logger.info('Contract PDF generated and uploaded', { contractId, pdfUrl });

    // Return { pdfUrl, contract } so the mobile client can navigate directly
    // to the PDF preview without a separate fetch.
    success(res, { pdfUrl: updated.pdfUrl ?? pdfUrl, contract: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contracts/:id/sign
 * Save the sender's signature and re-generate the PDF with it embedded.
 */
export async function saveSignature(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user.id;
    const contractId = req.params.id;

    const parsed = signContractSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Signature data is required');
    }

    const existing = await assertContractOwnership(contractId, userId);

    if (existing.status === ContractStatus.DRAFT) {
      throw new AppError('Generate the contract PDF before signing', 400);
    }

    // Upload signature to storage
    const { url: signatureUrl } = await uploadSignature(
      userId,
      contractId,
      'sender',
      parsed.data.signature
    );

    // Re-generate PDF with sender signature embedded
    const contractData: ContractData = toContractData({
      ...existing,
      mySignature: signatureUrl,
    });

    // Use the uploaded Supabase URL (not raw base64) so Puppeteer can fetch
    // the signature image reliably when rendering the PDF.
    const pdfBuffer = await embedSignatureInPdf(contractData, {
      sender: signatureUrl,
      recipient: existing.otherPartySignature,
    });

    const { url: pdfUrl, path: pdfStoragePath } = await uploadPdf(userId, contractId, pdfBuffer);

    const updated = await prisma.contract.update({
      where: { id: contractId },
      data: {
        mySignature: signatureUrl,
        pdfUrl,
        pdfStoragePath,
        status: ContractStatus.SIGNED_BY_ME,
        signedByMeAt: new Date(),
      },
    });

    logger.info('Sender signature saved', { contractId, userId });

    success(res, updated);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contracts/:id/send
 * Create a signing link and update the contract status to SENT.
 */
export async function createSigningLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user.id;
    const contractId = req.params.id;

    const parsed = sendContractSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid recipient details',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const existing = await assertContractOwnership(contractId, userId);

    if (
      existing.status === ContractStatus.DRAFT ||
      existing.status === ContractStatus.GENERATED
    ) {
      throw new AppError('Sign the contract before sending it to the other party', 400);
    }

    const { otherPartyEmail, otherPartyName, expiresInDays } = parsed.data;

    const signingToken = createSigningToken(contractId, expiresInDays);
    const signingLinkExpiry = getTokenExpiry(signingToken);
    const signingLink = getSigningLink(signingToken);

    const updated = await prisma.contract.update({
      where: { id: contractId },
      data: {
        otherPartyEmail,
        otherPartyName,
        signingToken,
        signingLinkExpiry,
        status: ContractStatus.SENT,
        sentAt: new Date(),
      },
    });

    logger.info('Signing link created', {
      contractId,
      userId,
      recipientEmail: otherPartyEmail,
      expiresInDays,
    });

    success(res, {
      contract: updated,
      signingLink,
      expiresAt: signingLinkExpiry,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/contracts/:id/status
 * Lightweight polling endpoint for contract status.
 */
export async function getContractStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const contract = await assertContractOwnership(req.params.id, req.user.id);

    success(res, {
      id: contract.id,
      status: contract.status,
      otherPartySignature: contract.otherPartySignature ? true : false, // Don't leak the actual base64
      otherPartyName: contract.otherPartyName,
      otherPartyEmail: contract.otherPartyEmail,
      viewedAt: contract.viewedAt,
      signedByMeAt: contract.signedByMeAt,
      sentAt: contract.sentAt,
      signedByOtherAt: contract.signedByOtherAt,
      completedAt: contract.completedAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/contracts/:id
 * Deletes the contract and all associated storage files.
 */
export async function deleteContract(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user.id;
    const contractId = req.params.id;

    await assertContractOwnership(contractId, userId);

    // Clean up storage files (best-effort, non-fatal)
    await deleteContractFiles(userId, contractId).catch((err) => {
      logger.warn('Failed to delete some storage files during contract deletion', {
        contractId,
        error: (err as Error).message,
      });
    });

    await prisma.contract.delete({ where: { id: contractId } });

    logger.info('Contract deleted', { contractId, userId });

    noContent(res);
  } catch (err) {
    next(err);
  }
}
