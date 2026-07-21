import { BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Product image upload policy: JPG/PNG/WebP, streamed straight to Cloudinary
 * (never touches local disk — matters for a host like Render, where the
 * filesystem isn't guaranteed to persist across deploys). Reads CLOUDINARY_URL
 * from the environment (cloudinary://<api_key>:<api_secret>@<cloud_name> —
 * exactly what the Cloudinary dashboard hands you).
 */
export function productImageOptions(maxBytes: number): MulterOptions {
  cloudinary.config();
  return {
    storage: new CloudinaryStorage({
      cloudinary,
      // multer-storage-cloudinary's Params type over-narrows against this
      // cloudinary version's UploadApiOptions and rejects known-good keys.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: { folder: 'continental/products', resource_type: 'image' } as any,
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED.includes(file.mimetype)) cb(null, true);
      else cb(new BadRequestException('Only JPG, PNG or WebP images are allowed'), false);
    },
  };
}

/** Recovers a Cloudinary public_id from a secure_url — there's no reverse lookup API for it. */
function cloudinaryPublicId(url: string): string | null {
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  return m ? m[1] : null;
}

/** Best-effort delete — a stray Cloudinary asset costs nothing to leave behind. */
export function deleteProductImage(image: string): void {
  if (!image) return;
  const publicId = cloudinaryPublicId(image);
  if (!publicId) return;
  cloudinary.config();
  cloudinary.uploader.destroy(publicId).catch(() => undefined);
}
