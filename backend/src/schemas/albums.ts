import { Type } from '@sinclair/typebox';

export const CreateAlbumBody = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    is_public: Type.Optional(Type.Boolean()),
    password: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    exif_strip: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const PatchAlbumBody = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    is_public: Type.Optional(Type.Boolean()),
    exif_strip: Type.Optional(Type.Boolean()),
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
