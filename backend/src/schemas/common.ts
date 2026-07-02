import { Type } from '@sinclair/typebox';

export const UidParams = Type.Object(
  { uid: Type.String({ pattern: '^[0-9A-Za-z]{14}$' }) },
  { additionalProperties: false },
);

export const UidPhotoParams = Type.Object(
  {
    uid: Type.String({ pattern: '^[0-9A-Za-z]{14}$' }),
    id: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
