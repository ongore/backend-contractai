import { supabase } from '../../config/supabase';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';

// ─── Bucket names ─────────────────────────────────────────────────────────────
const CONTRACTS_BUCKET = 'contracts';
const SIGNATURES_BUCKET = 'signatures';

const DEFAULT_SIGNED_URL_EXPIRY = 60 * 60 * 24 * 7; // 7 days in seconds

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base64ToBuffer(base64DataUrl: string): { buffer: Buffer; mimeType: string } {
  // Accepts "data:image/png;base64,XXXX" or raw base64
  const matches = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (matches) {
    return {
      mimeType: matches[1],
      buffer: Buffer.from(matches[2], 'base64'),
    };
  }
  // Assume raw base64 PNG if no data URL prefix
  return {
    mimeType: 'image/png',
    buffer: Buffer.from(base64DataUrl, 'base64'),
  };
}

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? 'bin';
}

// ─── PDF Storage ──────────────────────────────────────────────────────────────

export interface StorageResult {
  url: string;
  path: string;
}

/**
 * Upload a generated contract PDF to Supabase Storage.
 * Returns the public/signed URL and the storage path.
 */
export async function uploadPdf(
  userId: string,
  contractId: string,
  buffer: Buffer
): Promise<StorageResult> {
  const path = `${userId}/${contractId}/contract.pdf`;

  logger.debug('Uploading PDF to storage', { path, sizeBytes: buffer.length });

  const { error } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true, // overwrite if re-generating
    });

  if (error) {
    logger.error('Failed to upload PDF', { path, error: error.message });
    throw new AppError(`Failed to store contract PDF: ${error.message}`, 500);
  }

  const url = await getSignedUrl(CONTRACTS_BUCKET, path, DEFAULT_SIGNED_URL_EXPIRY);

  logger.info('PDF uploaded successfully', { path });
  return { url, path };
}

/**
 * Upload a signature image (base64 data URL) to Supabase Storage.
 * role: 'sender' | 'recipient'
 */
export async function uploadSignature(
  userId: string,
  contractId: string,
  role: 'sender' | 'recipient',
  base64DataUrl: string
): Promise<StorageResult> {
  const { buffer, mimeType } = base64ToBuffer(base64DataUrl);
  const ext = mimeToExtension(mimeType);
  const path = `${userId}/${contractId}/${role}_signature.${ext}`;

  logger.debug('Uploading signature to storage', { path, role, sizeBytes: buffer.length });

  const { error } = await supabase.storage
    .from(SIGNATURES_BUCKET)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    logger.error('Failed to upload signature', { path, error: error.message });
    throw new AppError(`Failed to store signature: ${error.message}`, 500);
  }

  // Signatures bucket: generate a long-lived signed URL (30 days)
  const url = await getSignedUrl(SIGNATURES_BUCKET, path, 60 * 60 * 24 * 30);

  logger.info('Signature uploaded successfully', { path, role });
  return { url, path };
}

/**
 * Delete a file from Supabase Storage by its storage path.
 * Silently logs if the delete fails (non-fatal).
 */
export async function deleteFile(
  path: string,
  bucket = CONTRACTS_BUCKET
): Promise<void> {
  logger.debug('Deleting file from storage', { bucket, path });

  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) {
    // Log but don't throw — deletion failure is non-fatal for the main flow
    logger.warn('Failed to delete storage file', { path, error: error.message });
  } else {
    logger.debug('File deleted from storage', { path });
  }
}

/**
 * Generate a signed URL for a private storage object.
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn = DEFAULT_SIGNED_URL_EXPIRY
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    logger.error('Failed to create signed URL', { bucket, path, error: error?.message });
    throw new AppError(`Failed to generate storage URL: ${error?.message ?? 'Unknown'}`, 500);
  }

  return data.signedUrl;
}

/**
 * Delete all files associated with a contract (PDF + signatures).
 */
export async function deleteContractFiles(
  userId: string,
  contractId: string
): Promise<void> {
  const pdfPath = `${userId}/${contractId}/contract.pdf`;
  const senderSigPath = `${userId}/${contractId}/sender_signature.png`;
  const recipientSigPath = `${userId}/${contractId}/recipient_signature.png`;

  await Promise.allSettled([
    deleteFile(pdfPath, CONTRACTS_BUCKET),
    deleteFile(senderSigPath, SIGNATURES_BUCKET),
    deleteFile(recipientSigPath, SIGNATURES_BUCKET),
  ]);
}
