// Pure support-ticket logic for the native 3-step form (a port of web's
// app/(docs)/support/support-form.tsx). The ticket JSON and the upload
// multipart use exactly the field names the web form posts, so the native
// screen submits to the same endpoints the moment they exist.
//
// Pure by the support-policy rule: the API base, cookie and fetch are passed
// in, so no react-native import can break the one path that must never throw.
export interface SupportFormFields {
  browser: string;
  category: string;
  email: string;
  message: string;
  os: string;
  priority: string;
  subject: string;
  type: string;
}

export interface SupportAttachmentUpload {
  key: string;
  name: string;
  type: string;
  url: string;
}

export interface SupportRequestOptions {
  apiBase: string;
  baseFetch?: typeof fetch;
  cookie?: string;
}

export const SUPPORT_MAX_ATTACHMENTS = 3;

export const SUPPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export const SUPPORT_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/pdf",
  "text/plain",
];

export class SupportSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportSubmitError";
  }
}

const SUPPORT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSupportEmailValid(email: string): boolean {
  return SUPPORT_EMAIL_PATTERN.test(email);
}

export function canContinueFromSupportStepOne(
  fields: SupportFormFields
): boolean {
  return isSupportEmailValid(fields.email) && fields.type.length > 0;
}

export function canContinueFromSupportStepTwo(
  fields: SupportFormFields
): boolean {
  return fields.category.length > 0 && fields.subject.trim().length > 0;
}

export function isSupportAttachmentAllowed(
  attachments: number,
  fileCount: number
): boolean {
  return attachments + fileCount <= SUPPORT_MAX_ATTACHMENTS;
}

export function supportAttachmentProblem(
  type: string | undefined,
  size: number
): string | null {
  if (!type || !SUPPORT_ALLOWED_TYPES.includes(type)) {
    return "Images, PDFs, or text files only, please";
  }
  if (size > SUPPORT_MAX_FILE_BYTES) {
    return "Keep files under 5MB";
  }
  return null;
}

export function buildSupportPayload(
  fields: SupportFormFields,
  attachments: SupportAttachmentUpload[]
): Record<string, unknown> {
  return { ...fields, attachments };
}

function supportFetch(options: SupportRequestOptions): typeof fetch {
  return options.baseFetch ?? fetch;
}

function supportHeaders(
  options: SupportRequestOptions
): Record<string, string> {
  return options.cookie ? { cookie: options.cookie } : {};
}

// Uploads one file the way web's uploadFile does (File + fileName + fileType
// fields to /api/support/upload). Throws SupportSubmitError carrying the
// server's message so the screen can show it.
export async function uploadSupportAttachment(
  file: File,
  fileName: string,
  fileType: string,
  options: SupportRequestOptions
): Promise<SupportAttachmentUpload> {
  const body = new FormData();
  body.append("file", file);
  body.append("fileName", fileName);
  body.append("fileType", fileType);
  const response = await supportFetch(options)(
    `${options.apiBase}/api/support/upload`,
    {
      body,
      headers: supportHeaders(options),
      method: "POST",
    }
  );
  const data = (await response.json().catch(() => null)) as {
    error?: string;
    key?: string;
    url?: string;
  } | null;
  if (!response.ok || !data?.key || !data?.url) {
    throw new SupportSubmitError(data?.error ?? "Upload failed");
  }
  return { key: data.key, name: fileName, type: fileType, url: data.url };
}

// Posts the ticket the way web's submitSupportMessage does: the form fields
// plus the uploaded attachments as JSON to /api/support.
export async function submitSupportTicket(
  fields: SupportFormFields,
  attachments: SupportAttachmentUpload[],
  options: SupportRequestOptions
): Promise<void> {
  const response = await supportFetch(options)(
    `${options.apiBase}/api/support`,
    {
      body: JSON.stringify(buildSupportPayload(fields, attachments)),
      headers: {
        "Content-Type": "application/json",
        ...supportHeaders(options),
      },
      method: "POST",
    }
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new SupportSubmitError(data?.error ?? "Failed to send message");
  }
}
