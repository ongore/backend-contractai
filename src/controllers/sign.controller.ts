import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { verifySigningToken } from '../services/signing/signingService';
import { embedSignatureInPdf, ContractData } from '../services/pdf/pdfService';
import { uploadPdf, uploadSignature } from '../services/storage/storageService';
import { success } from '../utils/response';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  AppError,
} from '../utils/errors';
import logger from '../utils/logger';
import { ContractStatus, ContractType } from '@prisma/client';
import { ExtractedField } from '../services/ai/extractService';

// ─── Validation ───────────────────────────────────────────────────────────────

const submitSignatureSchema = z.object({
  signature: z.string().min(10, 'Signature data is required'), // base64 data URL
  signerName: z.string().min(1).max(200).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function resolveContractFromToken(token: string) {
  // Throws UnauthorizedError if token is invalid/expired
  const { contractId } = verifySigningToken(token);

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  // Verify the stored token matches (guards against revoked tokens)
  if (contract.signingToken !== token) {
    throw new UnauthorizedError('This signing link is no longer valid.');
  }

  // Check that the contract is in a signable state
  if (
    contract.status === ContractStatus.COMPLETED ||
    contract.status === ContractStatus.DRAFT ||
    contract.status === ContractStatus.GENERATED
  ) {
    throw new AppError(
      contract.status === ContractStatus.COMPLETED
        ? 'This contract has already been signed and completed.'
        : 'This contract is not ready for signing.',
      400
    );
  }

  return contract;
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/sign/:token
 * Public endpoint. Validates the signing token and returns a safe preview
 * of the contract for the recipient to review before signing.
 */
export async function getContractForSigning(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token } = req.params;

    if (!token) {
      throw new UnauthorizedError('Signing token is required');
    }

    const contract = await resolveContractFromToken(token);

    // Mark as viewed on first access
    const isFirstView = !contract.viewedAt;

    if (isFirstView) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: ContractStatus.VIEWED,
          viewedAt: new Date(),
        },
      });

      logger.info('Contract viewed by recipient', {
        contractId: contract.id,
        recipientEmail: contract.otherPartyEmail,
      });
    }

    // Return safe preview — exclude sensitive fields like raw JWT token
    success(res, {
      id: contract.id,
      title: contract.title,
      type: contract.type,
      status: isFirstView ? ContractStatus.VIEWED : contract.status,
      extractedFields: contract.extractedFields,
      pdfUrl: contract.pdfUrl,
      otherPartyName: contract.otherPartyName,
      otherPartyEmail: contract.otherPartyEmail,
      // Sender party info from extracted fields
      parties: {
        sender: (contract.extractedFields as unknown as ExtractedField[])?.find(
          (f) => f.key === 'partyOneName'
        )?.value ?? null,
        recipient: contract.otherPartyName,
      },
      senderSigned: !!contract.mySignature,
      recipientSigned: !!contract.otherPartySignature,
      signingLinkExpiry: contract.signingLinkExpiry,
      createdAt: contract.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/sign/:token
 * Public endpoint. Accepts the recipient's signature, embeds it in the PDF,
 * and marks the contract as COMPLETED.
 */
export async function submitSignature(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token } = req.params;

    if (!token) {
      throw new UnauthorizedError('Signing token is required');
    }

    const parsed = submitSignatureSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Signature data is required');
    }

    const contract = await resolveContractFromToken(token);

    if (contract.status === ContractStatus.COMPLETED || contract.otherPartySignature) {
      throw new AppError('This contract has already been signed.', 400);
    }

    logger.info('Processing recipient signature', {
      contractId: contract.id,
      recipientEmail: contract.otherPartyEmail,
    });

    const { signature } = parsed.data;

    // Upload recipient signature to storage
    const { url: recipientSigUrl } = await uploadSignature(
      contract.userId,
      contract.id,
      'recipient',
      signature
    );

    // Embed both signatures in the final PDF
    const contractData = toContractData({
      ...contract,
      otherPartySignature: recipientSigUrl,
    });

    const finalPdfBuffer = await embedSignatureInPdf(contractData, {
      sender: contract.mySignature ?? undefined,
      recipient: signature, // Use raw base64 for PDF embedding
    });

    // Upload final signed PDF (overwrites the unsigned version)
    const { url: finalPdfUrl, path: finalPdfPath } = await uploadPdf(
      contract.userId,
      contract.id,
      finalPdfBuffer
    );

    const now = new Date();

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        otherPartySignature: recipientSigUrl,
        pdfUrl: finalPdfUrl,
        pdfStoragePath: finalPdfPath,
        status: ContractStatus.COMPLETED,
        signedByOtherAt: now,
        completedAt: now,
      },
    });

    logger.info('Contract completed — both parties have signed', {
      contractId: contract.id,
      completedAt: now,
    });

    success(res, {
      id: updated.id,
      status: updated.status,
      completedAt: updated.completedAt,
      pdfUrl: updated.pdfUrl,
      message: 'Contract signed successfully. Both parties have now signed.',
    });
  } catch (err) {
    next(err);
  }
}
