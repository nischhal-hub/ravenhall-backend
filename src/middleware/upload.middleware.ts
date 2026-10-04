import multer, { FileFilterCallback } from "multer";
import { Request, RequestHandler } from "express";
import { AppError } from "../utils/AppError";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new AppError("Only JPEG, PNG, WEBP, GIF or PDF files are allowed", 400));
  }
  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
});

export const uploadLaneImage: RequestHandler = upload.single("image");
export const uploadExpenseReceipt: RequestHandler = upload.single("receipt");
