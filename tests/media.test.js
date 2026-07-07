const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTwilioMedia,
  extensionForContentType,
  isAllowedImageType,
} = require('../bot/media');

describe('media', () => {
  it('parses Twilio media fields', () => {
    const media = parseTwilioMedia({
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/abc',
      MediaContentType0: 'image/jpeg',
      MessageSid: 'SM123',
    });

    assert.equal(media.url, 'https://api.twilio.com/media/abc');
    assert.equal(media.contentType, 'image/jpeg');
    assert.equal(media.mediaSid, 'SM123');
  });

  it('returns null when no media', () => {
    assert.equal(parseTwilioMedia({ NumMedia: '0' }), null);
  });

  it('validates image types', () => {
    assert.equal(isAllowedImageType('image/jpeg'), true);
    assert.equal(isAllowedImageType('application/pdf'), false);
    assert.equal(extensionForContentType('image/png'), 'png');
  });
});
