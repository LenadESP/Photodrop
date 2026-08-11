import { Type } from '@sinclair/typebox';

// expires_at: epoch ms after which the link dies and the album is deleted; null
// (or omitted) = never. Guard against a nonsensically small value.
const ExpiresAt = Type.Union([Type.Integer({ minimum: 1_000_000_000_000 }), Type.Null()]);

export const CreateAlbumBody = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    is_public: Type.Optional(Type.Boolean()),
    password: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    exif_strip: Type.Optional(Type.Boolean()),
    expires_at: Type.Optional(ExpiresAt),
  },
  { additionalProperties: false },
);

export const PatchAlbumBody = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    is_public: Type.Optional(Type.Boolean()),
    exif_strip: Type.Optional(Type.Boolean()),
    expires_at: Type.Optional(ExpiresAt),
  },
  { additionalProperties: false, minProperties: 1 },
);

// password: a string sets it, null removes it.
export const SetPasswordBody = Type.Object(
  { password: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]) },
  { additionalProperties: false },
);

export const UnlockBody = Type.Object(
  { password: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);

// Admin decision on a failed photo:
//   retry  — reprocess as-is (strip + poster) now the timeout is fixed.
//   accept — "upload anyway": reprocess WITHOUT the metadata strip, keeping the
//            original's tags. (Delete is the existing DELETE /photos/:id route.)
export const ResolvePhotoBody = Type.Object(
  { action: Type.Union([Type.Literal('retry'), Type.Literal('accept')]) },
  { additionalProperties: false },
);
