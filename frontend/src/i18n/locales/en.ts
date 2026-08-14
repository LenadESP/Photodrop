// The source catalogue. Every other locale is typed against it, so adding a key
// here fails the build until each translation supplies it.
//
// A value is either a plain string or a set of plural forms keyed by CLDR
// category. English and Spanish only ever use one/other, but the shape accepts
// the full set (zero/one/two/few/many/other) so a language with richer plural
// rules is a catalogue file rather than a refactor. `other` is mandatory and is
// the fallback for any category a locale doesn't spell out.
export const en = {
  // ── Shared ────────────────────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.create': 'Create',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.new': 'New',
  'common.areYouSure': 'Are you sure?',
  'common.somethingWentWrong': 'Something went wrong',

  // ── Chrome ────────────────────────────────────────────────────────────────
  'nav.adminDashboard': 'Admin dashboard',
  'nav.logIn': 'Log in',
  'nav.logOut': 'Log out',

  'theme.switchToLight': 'Switch to light mode',
  'theme.switchToDark': 'Switch to dark mode',
  'theme.lightMode': 'Light mode',
  'theme.darkMode': 'Dark mode',

  // The endonym — always written in its own language, never translated, so a
  // speaker can find their language without reading the current one.
  'lang.name': 'English',
  'lang.switchTo': 'Switch to {language}',

  // ── Home ──────────────────────────────────────────────────────────────────
  'home.tagline': 'Ask the web manager for a link, or log in to see your assigned albums.',
  'home.goToDashboard': 'Go to dashboard',

  // ── Login ─────────────────────────────────────────────────────────────────
  'login.title': 'Log in',
  'login.subtitle': 'Enter your credentials to continue.',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.checking': 'Checking…',
  'login.continue': 'Continue',
  'login.enrollTitle': 'Set up two-factor',
  'login.enrollSubtitle': 'Scan this with your authenticator app, then enter the 6-digit code.',
  'login.qrAlt': 'TOTP QR code',
  'login.orEnterManually': 'Or enter manually:',
  'login.code': '6-digit code',
  'login.verifying': 'Verifying…',
  'login.activateContinue': 'Activate & continue',
  'login.mfaTitle': 'Two-factor',
  'login.mfaSubtitle': 'Enter the 6-digit code from your authenticator app.',
  'login.verify': 'Verify',

  // ── Gallery (recipient-facing) ────────────────────────────────────────────
  'gallery.privateAlbum': 'Private album',
  'gallery.notFoundTitle': 'Album not found',
  'gallery.notFoundBody': 'This link may have expired or been revoked.',
  'gallery.passwordProtected': 'This album is password-protected.',
  'gallery.wrongPassword': 'Wrong password',
  'gallery.viewAlbum': 'View album',
  'gallery.photoCount': { one: '{count} photo', other: '{count} photos' },
  'gallery.processingCount': '{count} processing…',
  'gallery.downloadAll': 'Download all',
  'gallery.downloadZip': 'Download ZIP',
  'gallery.starting': 'Starting…',
  'gallery.downloading': 'Downloading {started} / {total}…',
  'gallery.multipleDownloadsHint':
    'Your browser may ask to allow multiple downloads — tap Allow to save them all.',
  'gallery.empty': 'This album is empty.',
  'gallery.processing': 'Processing…',

  // ── Lightbox ──────────────────────────────────────────────────────────────
  'lightbox.save': 'Save',
  'lightbox.previous': 'Previous',
  'lightbox.next': 'Next',
  'lightbox.zoomIn': 'Zoom in',
  'lightbox.zoomOut': 'Zoom out',
  'lightbox.videoPreparing':
    'This video is still being prepared for playback. You can download the full-resolution original now.',
  'lightbox.videoTooLarge':
    'This video is too large to preview in the browser. Download the full-resolution original to watch it.',

  // ── Upload zone ───────────────────────────────────────────────────────────
  'upload.drop': 'Drop photos or video here',
  'upload.chooseHint': 'or click to choose — JPG, PNG, WebP, MP4, MOV',
  'upload.uploading': 'Uploading…',
  'upload.uploadingPct': 'Uploading {pct}%…',
  'upload.fileProgress': '{done}/{total} files',
  'upload.failed': 'upload failed',
  'upload.cancelled': 'Upload cancelled',
  'upload.networkError': 'Network error during upload',
  'upload.partFailed': 'Part upload failed',
  'upload.downloadFailed': 'Download failed',

  // ── Admin: layout ─────────────────────────────────────────────────────────
  'admin.albums': 'Albums',
  'admin.noAlbums': 'No albums yet.',
  'admin.selectOrCreate': 'Select or create an album.',

  // ── Admin: album controls ─────────────────────────────────────────────────
  'admin.badgePublic': 'Public',
  'admin.badgePrivate': 'Private',
  'admin.badgePassword': 'Password',
  'admin.badgeExifStripped': 'EXIF stripped',
  'admin.badgeExifKept': 'EXIF kept',
  'admin.badgeExpires': 'Expires {date}',
  'admin.rename': 'Rename',
  'admin.makePrivate': 'Make private',
  'admin.makePublic': 'Make public',
  'admin.keepExif': 'Keep EXIF',
  'admin.stripExif': 'Strip EXIF',
  'admin.removePassword': 'Remove password',
  'admin.setPassword': 'Set password',
  'admin.regenerateLink': 'Regenerate link',
  'admin.clearExpiry': 'Clear expiry',
  'admin.setExpiry': 'Set expiry',

  // ── Admin: modals ─────────────────────────────────────────────────────────
  'admin.newAlbum': 'New album',
  'admin.fieldTitle': 'Title',
  'admin.publicCheckbox': 'Public (anyone with the link can view)',
  'admin.fieldPasswordOptional': 'Password (optional)',
  'admin.passwordPlaceholder': 'Leave blank for none',
  'admin.renameAlbum': 'Rename album',
  'admin.setAlbumPassword': 'Set album password',
  'admin.fieldNewPassword': 'New password',
  'admin.setLinkExpiry': 'Set link expiry',
  'admin.fieldExpiryDays': 'Days until the link expires',

  // ── Admin: confirmations ──────────────────────────────────────────────────
  'admin.confirmRegenerate':
    'Generate a new link? The current link will stop working immediately.',
  'admin.confirmDeleteAlbum':
    'Delete “{title}” and all its photos? This cannot be undone.',
  'admin.confirmDeletePhoto': 'Delete this photo?',
  'admin.confirmUploadAnyway':
    'Upload this file anyway? It will be served with its original metadata (GPS, camera info) intact — the album’s EXIF stripping is skipped for this one file.',
  'admin.confirmCancelUpload':
    'Cancel this upload and delete the file? This cannot be undone.',

  // ── Admin: toasts ─────────────────────────────────────────────────────────
  'admin.toastAlbumCreated': 'Album created',
  'admin.toastAlbumDeleted': 'Album deleted',
  'admin.toastPasswordSet': 'Password set',
  'admin.toastPasswordRemoved': 'Password removed',
  'admin.toastLinkCopied': 'Link copied',
  'admin.toastLinkRegenerated': 'New link generated — the old one no longer works',
  'admin.toastRetrying': 'Retrying…',
  'admin.toastReprocessing': 'Reprocessing without metadata strip…',
  'admin.toastUploaded': { one: 'Uploaded {count} photo', other: 'Uploaded {count} photos' },
  'admin.errUpdateFailed': 'Update failed',
  'admin.errCreateFailed': 'Create failed',
  'admin.errDeleteFailed': 'Delete failed',
  'admin.errActionFailed': 'Action failed',
  'admin.errFailed': 'Failed',
  'admin.errPositiveDays': 'Enter a positive number of days',

  // ── Admin: failed-photo panel ─────────────────────────────────────────────
  'admin.failedHeading': {
    one: '{count} file failed to process',
    other: '{count} files failed to process',
  },
  'admin.failedReason': 'Error uploading: {reason}',
  'admin.failedFallback': 'Processing failed',
  'admin.tryAgain': 'Try again',
  'admin.uploadAnyway': 'Upload anyway',
} as const;

export type MessageKey = keyof typeof en;

/** CLDR plural categories. `other` is required; the rest are per-locale. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralForms;

/**
 * A translation must supply every key, and must keep the plural-vs-plain shape
 * of the source: a key that pluralises in English pluralises everywhere.
 */
export type Catalogue = {
  [K in MessageKey]: (typeof en)[K] extends string ? string : PluralForms;
};
