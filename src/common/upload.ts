import { BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import type { StorageEngine } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const CLOUDINARY_FOLDER = 'continental/products';

/**
 * Streams the upload straight to Cloudinary (never touches local disk —
 * matters for a host like Render, where the filesystem isn't guaranteed to
 * persist across deploys). Replaces multer-storage-cloudinary: that package
 * pins cloudinary@1.x as a peer dependency, whose only fix for a real high-
 * severity argument-injection advisory shipped in the 2.x line, so keeping
 * it would mean staying on the vulnerable SDK. The interface it wraps is
 * genuinely this small.
 */
class CloudinaryStorage implements StorageEngine {
  _handleFile(
    _req: Express.Request,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: CLOUDINARY_FOLDER, resource_type: 'image' },
      (error, result) => {
        if (error || !result) { callback(error ?? new Error('Cloudinary upload failed')); return; }
        callback(undefined, {
          path: result.secure_url,
          filename: result.public_id,
          size: result.bytes,
        });
      },
    );
    file.stream.pipe(uploadStream);
  }

  _removeFile(_req: Express.Request, file: Express.Multer.File, callback: (error: Error | null) => void): void {
    // .filename was set to the Cloudinary public_id in _handleFile above.
    cloudinary.uploader.destroy(file.filename, { invalidate: true }, () => callback(null));
  }
}

/**
 * Product image upload policy: JPG/PNG/WebP. Reads CLOUDINARY_URL from the
 * environment (cloudinary://<api_key>:<api_secret>@<cloud_name> — exactly
 * what the Cloudinary dashboard hands you).
 */
export function productImageOptions(maxBytes: number): MulterOptions {
  cloudinary.config();
  return {
    storage: new CloudinaryStorage(),
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
  // invalidate: true also purges the old URL from Cloudinary's CDN edge
  // cache, not just the origin asset — otherwise a stale copy can keep
  // resolving at that exact URL for a while after deletion.
  cloudinary.uploader.destroy(publicId, { invalidate: true }).catch(() => undefined);
}
