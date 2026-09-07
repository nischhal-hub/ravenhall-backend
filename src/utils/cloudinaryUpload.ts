import { cloudinary } from "../config/cloudinary";
import { AppError } from "./AppError";

const LANE_IMAGE_FOLDER = "ravenhall/lanes";

export const uploadImageToCloudinary = (
  buffer: Buffer,
  folder: string = LANE_IMAGE_FOLDER,
): Promise<{ secureUrl: string; publicId: string }> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error || !result) {
          return reject(new AppError("Image upload failed", 502));
        }
        resolve({ secureUrl: result.secure_url, publicId: result.public_id });
      },
    );
    uploadStream.end(buffer);
  });
};

export const deleteImageFromCloudinary = async (
  imageUrl: string,
): Promise<void> => {
  const publicId = extractPublicId(imageUrl);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch {
    // best-effort cleanup — never block the main request on this
  }
};

const extractPublicId = (url: string): string | null => {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1] : null;
};
