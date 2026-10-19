import multer, { FileFilterCallback } from "multer";
import { Request, RequestHandler } from "express";
import { AppError } from "../utils/AppError";

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Receipts may also be scanned/PDF documents
const RECEIPT_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const createUpload = (allowedMimeTypes: string[], message: string) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: FileFilterCallback,
    ) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new AppError(message, 400));
      }
      cb(null, true);
    },
  });

const imageUpload = createUpload(
  IMAGE_MIME_TYPES,
  "Only JPEG, PNG, WEBP or GIF images are allowed",
);
const receiptUpload = createUpload(
  RECEIPT_MIME_TYPES,
  "Only JPEG, PNG, WEBP, GIF or PDF files are allowed",
);

export const uploadLaneImage: RequestHandler = imageUpload.single("image");
export const uploadExpenseReceipt: RequestHandler = receiptUpload.single("receipt");
