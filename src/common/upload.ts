import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as crypto from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Product image upload policy: JPG/PNG/WebP, 5 MB, random collision-free names. */
export function productImageOptions(uploadsDir: string, maxBytes: number): MulterOptions {
  return {
    storage: diskStorage({
      destination: uploadsDir,
      filename: (_req, file, cb) => {
        const ext = ALLOWED[file.mimetype] || '.jpg';
        cb(null, `p-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED[file.mimetype]) cb(null, true);
      else cb(new BadRequestException('Only JPG, PNG or WebP images are allowed'), false);
    },
  };
}
