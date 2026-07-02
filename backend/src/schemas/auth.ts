import { Type } from '@sinclair/typebox';

export const LoginBody = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 64 }),
    password: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const TotpBody = Type.Object(
  { code: Type.String({ pattern: '^[0-9]{6}$' }) },
  { additionalProperties: false },
);
