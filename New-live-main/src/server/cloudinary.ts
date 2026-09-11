// ---------------------------------------------------------------------------
// Cloudinary upload helper
// ---------------------------------------------------------------------------
// All image uploads (KYC selfie/NIC, avatars, status images) go through
// here. The upload is authenticated with CLOUDINARY_API_SECRET server-side
// (a "signed" upload in Cloudinary's terms) — the client never sees the
// secret and can't upload directly with arbitrary params.
// ---------------------------------------------------------------------------

import { v2 as cloudinary } from "cloudinary";

let configured = false;

function ensureConfigured() {
  if (configured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  configured = true;
}

export type UploadKind = "avatar" | "kyc_selfie" | "kyc_nic_front" | "kyc_nic_back" | "status";

const FOLDER_BY_KIND: Record<UploadKind, string> = {
  avatar: "valentine-express/avatars",
  kyc_selfie: "valentine-express/kyc/selfies",
  kyc_nic_front: "valentine-express/kyc/nic",
  kyc_nic_back: "valentine-express/kyc/nic",
  status: "valentine-express/statuses",
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB

export interface UploadResult {
  url: string;
  publicId: string;
}

/**
 * Uploads an image buffer to Cloudinary under a per-user, per-kind folder.
 * KYC images are marked private-ish via an access-controlled folder name
 * (Cloudinary delivery is still by URL — restrict who ever receives these
 * URLs at the application layer, e.g. only admins reviewing KYC).
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  kind: UploadKind,
  userId: string,
): Promise<UploadResult> {
  ensureConfigured();

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large (max 8MB).");
  }

  const folder = `${FOLDER_BY_KIND[kind]}/${userId}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        overwrite: true,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

// NOTE on KYC image privacy: uploads currently use Cloudinary's standard
// "upload" delivery type (URL is viewable by anyone who has it, though the
// folder path is per-user and not enumerable). The URLs are only ever
// returned to the uploading user and to admins via the authenticated
// /api/admin/kyc route. For stricter access control, switch KYC uploads to
// Cloudinary's "authenticated" delivery type with signed, time-limited URLs
// generated on demand in the admin KYC route — left as a follow-up since it
// requires the Cloudinary account's token-auth feature to be enabled.

// ---------------------------------------------------------------------------
// Direct-to-Cloudinary signed uploads
// ---------------------------------------------------------------------------
// Routing every image byte through our own Vercel serverless function (the
// uploadImageBuffer path above) hits Vercel's request body size limit on
// larger photos — a 413 "Payload Too Large" error. The fix is to have the
// browser upload directly to Cloudinary instead: we hand it a short-lived
// signature (proving we authorized this exact upload) and the file bytes
// never pass through our server at all, so Vercel's limit doesn't apply.
export interface SignedUploadParams {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
}

export function getSignedUploadParams(
  kind: UploadKind,
  userId: string,
): SignedUploadParams {
  ensureConfigured();

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;
  const folder = `${FOLDER_BY_KIND[kind]}/${userId}`;
  const timestamp = Math.round(Date.now() / 1000);

  // Only parameters actually sent in the upload request get signed —
  // file/api_key/cloud_name/resource_type are excluded per Cloudinary's rules.
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    apiSecret,
  );

  return { cloudName, apiKey, timestamp, folder, signature };
}
