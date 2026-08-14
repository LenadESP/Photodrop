import type { Catalogue } from './en.js';

// Typed as Catalogue: omit a key and the build fails. Keep the placeholder
// names ({name}) identical to en — they are looked up by name, not position.
export const es: Catalogue = {
  'error.notFound': 'No encontrado',
  'error.unauthorized': 'No autorizado',
  'error.forbidden': 'Prohibido',
  'error.requestFailed': 'Error en la solicitud',
  'error.csrfInvalid': 'Token CSRF ausente o inválido',
  'error.rangeNotSatisfiable': 'Rango no satisfactorio',
  'error.rateLimited': 'Demasiadas solicitudes. Inténtalo de nuevo en unos momentos.',
  'error.badRequest': 'Solicitud incorrecta',
  'error.serverError': 'Se ha producido un error en el servidor',

  'auth.invalidCredentials': 'Credenciales inválidas',
  'auth.accountLocked': 'Cuenta bloqueada temporalmente. Inténtalo de nuevo más tarde.',
  'auth.invalidCode': 'Código inválido',
  'auth.codeAlreadyUsed': 'Código ya utilizado',
  'auth.totpAlreadyEnabled': 'La verificación en dos pasos ya está activada',
  'auth.noEnrollment': 'No hay ninguna configuración en curso',
  'auth.invalidState': 'Estado inválido',

  'album.invalidPassword': 'Contraseña incorrecta',

  'upload.noFiles': 'No se ha subido ningún archivo',
  'upload.noPhotos': 'No hay fotos',
  'upload.unsupportedFile': 'Archivo no admitido o inválido: {name}',
  'upload.fileTooLarge': 'El archivo supera el tamaño máximo de subida',
  'upload.limitExceeded': 'La subida supera el límite de tamaño o de cantidad',
  'upload.insufficientStorage': 'Espacio insuficiente en el servidor',

  'upload.partOutOfRange': 'Número de fragmento fuera de rango',
  'upload.partFailed': 'Error al subir el fragmento',
  'upload.incomplete': 'Subida incompleta',
  'upload.assembleFailed': 'No se pudo ensamblar la subida',
  'upload.sizeMismatch': 'El archivo ensamblado no coincide con el tamaño declarado',

  'media.metadataTimeout': 'Se agotó el tiempo al eliminar los metadatos',
  'media.metadataFailed': 'No se pudieron eliminar los metadatos',
  'media.posterFailed': 'No se pudo leer el vídeo',
  'media.processingFailed': 'Error al procesar',
  'media.photoNotFailed': 'La foto no está en estado fallido',
};
