import type { Catalogue } from './en';

// Typed as Catalogue: omit a key, or flatten a plural into a plain string, and
// the build fails. Placeholders are matched by name, so {count} / {title} /
// {date} must survive translation — their order in the sentence need not.
export const es: Catalogue = {
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.create': 'Crear',
  'common.confirm': 'Confirmar',
  'common.delete': 'Eliminar',
  'common.close': 'Cerrar',
  'common.copy': 'Copiar',
  'common.new': 'Nuevo',
  'common.areYouSure': '¿Estás seguro?',
  'common.somethingWentWrong': 'Algo ha salido mal',

  'nav.adminDashboard': 'Panel de administración',
  'nav.logIn': 'Iniciar sesión',
  'nav.logOut': 'Cerrar sesión',

  'theme.switchToLight': 'Cambiar a modo claro',
  'theme.switchToDark': 'Cambiar a modo oscuro',
  'theme.lightMode': 'Modo claro',
  'theme.darkMode': 'Modo oscuro',

  'lang.name': 'Español',
  'lang.switchTo': 'Cambiar a {language}',

  'home.tagline':
    'Pide un enlace al gestor web, o inicia sesión para ver los álbumes asignados a ti.',
  'home.goToDashboard': 'Ir al panel',

  'login.title': 'Iniciar sesión',
  'login.subtitle': 'Introduce tus credenciales para continuar.',
  'login.username': 'Usuario',
  'login.password': 'Contraseña',
  'login.checking': 'Comprobando…',
  'login.continue': 'Continuar',
  'login.enrollTitle': 'Configurar la verificación en dos pasos',
  'login.enrollSubtitle':
    'Escanea esto con tu aplicación de autenticación e introduce el código de 6 dígitos.',
  'login.qrAlt': 'Código QR para TOTP',
  'login.orEnterManually': 'O introdúcelo manualmente:',
  'login.code': 'Código de 6 dígitos',
  'login.verifying': 'Verificando…',
  'login.activateContinue': 'Activar y continuar',
  'login.mfaTitle': 'Verificación en dos pasos',
  'login.mfaSubtitle':
    'Introduce el código de 6 dígitos de tu aplicación de autenticación.',
  'login.verify': 'Verificar',

  'gallery.privateAlbum': 'Álbum privado',
  'gallery.notFoundTitle': 'Álbum no encontrado',
  'gallery.notFoundBody': 'Es posible que este enlace haya caducado o haya sido revocado.',
  'gallery.passwordProtected': 'Este álbum está protegido con contraseña.',
  'gallery.wrongPassword': 'Contraseña incorrecta',
  'gallery.viewAlbum': 'Ver álbum',
  'gallery.photoCount': { one: '{count} foto', other: '{count} fotos' },
  'gallery.processingCount': '{count} procesando…',
  'gallery.downloadAll': 'Descargar todo',
  'gallery.downloadZip': 'Descargar ZIP',
  'gallery.starting': 'Iniciando…',
  'gallery.downloading': 'Descargando {started} / {total}…',
  'gallery.multipleDownloadsHint':
    'Puede que tu navegador pida permiso para varias descargas — toca Permitir para guardarlas todas.',
  'gallery.empty': 'Este álbum está vacío.',
  'gallery.processing': 'Procesando…',

  'lightbox.save': 'Guardar',
  'lightbox.previous': 'Anterior',
  'lightbox.next': 'Siguiente',
  'lightbox.zoomIn': 'Acercar',
  'lightbox.zoomOut': 'Alejar',
  'lightbox.videoPreparing':
    'Este vídeo todavía se está preparando para la reproducción. Ya puedes descargar el original a resolución completa.',
  'lightbox.videoTooLarge':
    'Este vídeo es demasiado grande para previsualizarlo en el navegador. Descarga el original a resolución completa para verlo.',

  'upload.drop': 'Arrastra aquí fotos o vídeos',
  'upload.chooseHint': 'o haz clic para elegir — JPG, PNG, WebP, MP4, MOV',
  'upload.uploading': 'Subiendo…',
  'upload.uploadingPct': 'Subiendo {pct}%…',
  'upload.fileProgress': '{done}/{total} archivos',
  'upload.failed': 'error al subir',
  'upload.cancelled': 'Subida cancelada',
  'upload.networkError': 'Error de red durante la subida',
  'upload.partFailed': 'Error al subir el fragmento',
  'upload.downloadFailed': 'Error al descargar',

  'admin.albums': 'Álbumes',
  'admin.noAlbums': 'Todavía no hay álbumes.',
  'admin.selectOrCreate': 'Selecciona o crea un álbum.',

  'admin.badgePublic': 'Público',
  'admin.badgePrivate': 'Privado',
  'admin.badgePassword': 'Contraseña',
  'admin.badgeExifStripped': 'EXIF eliminado',
  'admin.badgeExifKept': 'EXIF conservado',
  'admin.badgeExpires': 'Caduca el {date}',
  'admin.rename': 'Renombrar',
  'admin.makePrivate': 'Hacer privado',
  'admin.makePublic': 'Hacer público',
  'admin.keepExif': 'Conservar EXIF',
  'admin.stripExif': 'Eliminar EXIF',
  'admin.removePassword': 'Quitar contraseña',
  'admin.setPassword': 'Establecer contraseña',
  'admin.regenerateLink': 'Regenerar enlace',
  'admin.clearExpiry': 'Quitar caducidad',
  'admin.setExpiry': 'Establecer caducidad',

  'admin.newAlbum': 'Nuevo álbum',
  'admin.fieldTitle': 'Título',
  'admin.publicCheckbox': 'Público (cualquiera con el enlace puede verlo)',
  'admin.fieldPasswordOptional': 'Contraseña (opcional)',
  'admin.passwordPlaceholder': 'Déjalo en blanco para no usar ninguna',
  'admin.renameAlbum': 'Renombrar álbum',
  'admin.setAlbumPassword': 'Establecer contraseña del álbum',
  'admin.fieldNewPassword': 'Nueva contraseña',
  'admin.setLinkExpiry': 'Establecer caducidad del enlace',
  'admin.fieldExpiryDays': 'Días hasta que caduque el enlace',

  'admin.confirmRegenerate':
    '¿Generar un enlace nuevo? El enlace actual dejará de funcionar de inmediato.',
  'admin.confirmDeleteAlbum':
    '¿Eliminar “{title}” y todas sus fotos? Esta acción no se puede deshacer.',
  'admin.confirmDeletePhoto': '¿Eliminar esta foto?',
  'admin.confirmUploadAnyway':
    '¿Subir este archivo de todos modos? Se servirá con sus metadatos originales (GPS, datos de la cámara) intactos — la eliminación de EXIF del álbum se omite para este archivo.',
  'admin.confirmCancelUpload':
    '¿Cancelar esta subida y eliminar el archivo? Esta acción no se puede deshacer.',

  'admin.toastAlbumCreated': 'Álbum creado',
  'admin.toastAlbumDeleted': 'Álbum eliminado',
  'admin.toastPasswordSet': 'Contraseña establecida',
  'admin.toastPasswordRemoved': 'Contraseña eliminada',
  'admin.toastLinkCopied': 'Enlace copiado',
  'admin.toastLinkRegenerated': 'Nuevo enlace generado — el anterior ya no funciona',
  'admin.toastRetrying': 'Reintentando…',
  'admin.toastReprocessing': 'Reprocesando sin eliminar los metadatos…',
  'admin.toastUploaded': {
    one: 'Se ha subido {count} foto',
    other: 'Se han subido {count} fotos',
  },
  'admin.errUpdateFailed': 'Error al actualizar',
  'admin.errCreateFailed': 'Error al crear',
  'admin.errDeleteFailed': 'Error al eliminar',
  'admin.errActionFailed': 'Error al ejecutar la acción',
  'admin.errFailed': 'Error',
  'admin.errPositiveDays': 'Introduce un número de días positivo',

  'admin.failedHeading': {
    one: '{count} archivo no se ha podido procesar',
    other: '{count} archivos no se han podido procesar',
  },
  'admin.failedReason': 'Error al subir: {reason}',
  'admin.failedFallback': 'Error al procesar',
  'admin.tryAgain': 'Reintentar',
  'admin.uploadAnyway': 'Subir de todos modos',
};
