// The source catalogue. Every other locale is type-checked against this one, so
// adding a key here breaks the build until every translation supplies it — that
// is the point: a missing translation is a compile error, never a blank string.
//
// Keys are namespaced by area, values carry `{name}` placeholders. Keep the
// English wording here identical to what the routes used to send inline.
export const en = {
  // Generic HTTP failures. Deliberately vague: 'Not found' is also what an
  // unauthorised request gets, so a probe can't distinguish "wrong id" from
  // "not yours".
  'error.notFound': 'Not found',
  'error.unauthorized': 'Unauthorized',
  'error.forbidden': 'Forbidden',
  'error.requestFailed': 'Request failed',
  'error.csrfInvalid': 'CSRF token missing or invalid',
  'error.rangeNotSatisfiable': 'Range not satisfiable',
  // Emitted by the framework rather than by a route: the rate limiter, TypeBox
  // validation rejections, and anything that reaches the error handler unclaimed.
  'error.rateLimited': 'Too many requests. Try again shortly.',
  'error.badRequest': 'Bad request',
  'error.serverError': 'Something went wrong on the server',

  // Auth. 'invalidCredentials' covers both unknown user and wrong password on
  // purpose — the caller must not learn which.
  'auth.invalidCredentials': 'Invalid credentials',
  'auth.accountLocked': 'Account temporarily locked. Try again later.',
  'auth.invalidCode': 'Invalid code',
  'auth.codeAlreadyUsed': 'Code already used',
  'auth.totpAlreadyEnabled': 'TOTP already enabled',
  'auth.noEnrollment': 'No enrollment in progress',
  'auth.invalidState': 'Invalid state',

  // Album access
  'album.invalidPassword': 'Invalid password',

  // Upload — validation and capacity
  'upload.noFiles': 'No files uploaded',
  'upload.noPhotos': 'No photos',
  'upload.unsupportedFile': 'Unsupported or invalid file: {name}',
  'upload.fileTooLarge': 'File exceeds the maximum upload size',
  'upload.limitExceeded': 'Upload exceeds the size or count limit',
  'upload.insufficientStorage': 'Insufficient storage on the server',

  // Upload — resumable session lifecycle
  'upload.partOutOfRange': 'Part number out of range',
  'upload.partFailed': 'Part upload failed',
  'upload.incomplete': 'Upload incomplete',
  'upload.assembleFailed': 'Failed to assemble upload',
  'upload.sizeMismatch': 'Assembled file does not match the declared size',

  // Media processing failures, persisted as photos.error_code and shown in the
  // dashboard next to the retry / upload-anyway / cancel actions.
  'media.metadataTimeout': 'Metadata stripping timed out',
  'media.metadataFailed': 'Metadata stripping failed',
  'media.posterFailed': 'Could not read the video',
  'media.processingFailed': 'Processing failed',
  'media.photoNotFailed': 'Photo is not in a failed state',
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;
