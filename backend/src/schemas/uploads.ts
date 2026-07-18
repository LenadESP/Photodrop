import { Type } from '@sinclair/typebox';

// Upload session ids use the same opaque 14-char alphabet as album uids, so the
// same pattern guards them — and paths built from one are validated before they
// ever reach the filesystem.
const SessionId = Type.String({ pattern: '^[0-9A-Za-z]{14}$' });

export const CreateUploadBody = Type.Object(
  {
    // The client's filename is metadata only: it is stored for display and for
    // the download filename, never used to build a path (originals get a random
    // stored name) and never trusted to determine the file's type.
    name: Type.String({ minLength: 1, maxLength: 255 }),
    size: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const UploadSessionParams = Type.Object({ id: SessionId }, { additionalProperties: false });

export const UploadPartParams = Type.Object(
  {
    id: SessionId,
    // Upper bound is checked against the session's total_parts in the handler;
    // this only guarantees a non-negative integer reaches it.
    part: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
