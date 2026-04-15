import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import { config } from '../config/env';
import { ValidationError } from '../utils/errors';

const MAX_FILE_SIZE = config.upload.maxFileSizeMb * 1024 * 1024; // bytes

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'application/pdf',
]);

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
): void {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new ValidationError(
        `Unsupported file type: ${file.mimetype}. Allowed types: images (JPEG, PNG, WEBP, HEIC, GIF) and PDF.`
      )
    );
  }
}

const storage = multer.memoryStorage();

const multerInstance = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
  },
  fileFilter,
});

/** Accept a single file under the field name "file" */
export const uploadSingle = multerInstance.single('file');

/** Accept any files (up to 5) across any field names */
export const uploadAny = multerInstance.any();

/** Accept a single file under a specific field name */
export function uploadField(fieldName: string) {
  return multerInstance.single(fieldName);
}
