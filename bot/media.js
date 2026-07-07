const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);

function parseTwilioMedia(body = {}) {
  const numMedia = Number(body.NumMedia || 0);
  if (!numMedia) return null;

  const url = body.MediaUrl0;
  const contentType = (body.MediaContentType0 || '').toLowerCase();
  const mediaSid = body.MessageSid || body.SmsMessageSid || null;

  if (!url) return null;

  return { url, contentType, mediaSid };
}

function extensionForContentType(contentType) {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

function isAllowedImageType(contentType) {
  return ALLOWED_IMAGE_TYPES.has((contentType || '').toLowerCase());
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  parseTwilioMedia,
  extensionForContentType,
  isAllowedImageType,
};
