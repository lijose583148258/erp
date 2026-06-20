const { TextDecoder } = require('util');

const WINDOWS_MOJIBAKE_TOKENS = [
  '\ufffd',
  '\u951f',
  '\u9416',
  '\u8fa9\u58b7',
  '\u6748\u7db7',
  '\u6d93\u8364\u568e',
  '\u93c1\u7248\u5d41',
  '\u7ecb\u51b2\u757e',
  '\u6d60\u8bf2\u59df',
  '\u59af\u6f61',
  '\u7039\u00a4\ue178',
  '\u95c2\u6401\u68ec',
  '\u6960\u5c7e\u6579',
  '\u6e1a\u6fca\u7986',
  '\u93b6\u30e5\u61a1',
  '\u9429\ue1bc\u7d8d',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WINDOWS_MOJIBAKE_PATTERN = new RegExp(WINDOWS_MOJIBAKE_TOKENS.map(escapeRegExp).join('|'), 'g');

function scoreMojibake(text) {
  if (!text) {
    return 0;
  }

  const matches = text.match(WINDOWS_MOJIBAKE_PATTERN);
  return matches ? matches.length : 0;
}

function decodeWithEncoding(buffer, encoding) {
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return '';
  }
}

function toBuffer(chunks) {
  const buffer = Buffer.concat(chunks.filter(Boolean));
  return buffer;
}

function decodeChildOutputDetails(chunks) {
  const buffer = toBuffer(chunks);
  if (buffer.length === 0) {
    return {
      text: '',
      selectedEncoding: 'empty',
      utf8Score: 0,
      gb18030Score: 0,
      byteLength: 0,
    };
  }

  const utf8Text = buffer.toString('utf8');
  if (process.platform !== 'win32') {
    return {
      text: utf8Text,
      selectedEncoding: 'utf8',
      utf8Score: scoreMojibake(utf8Text),
      gb18030Score: null,
      byteLength: buffer.length,
    };
  }

  const gb18030Text = decodeWithEncoding(buffer, 'gb18030');
  if (!gb18030Text) {
    return {
      text: utf8Text,
      selectedEncoding: 'utf8',
      utf8Score: scoreMojibake(utf8Text),
      gb18030Score: null,
      byteLength: buffer.length,
    };
  }

  const utf8Score = scoreMojibake(utf8Text);
  const gb18030Score = scoreMojibake(gb18030Text);
  const selectedEncoding = gb18030Score < utf8Score ? 'gb18030' : 'utf8';
  return {
    text: selectedEncoding === 'gb18030' ? gb18030Text : utf8Text,
    selectedEncoding,
    utf8Score,
    gb18030Score,
    byteLength: buffer.length,
  };
}

function decodeChildOutput(chunks) {
  return decodeChildOutputDetails(chunks).text;
}

function childOutputTailBase64(chunks, maxBytes = 512) {
  const buffer = toBuffer(chunks);
  if (buffer.length === 0) {
    return '';
  }
  return buffer.subarray(Math.max(0, buffer.length - maxBytes)).toString('base64');
}

module.exports = {
  childOutputTailBase64,
  decodeChildOutput,
  decodeChildOutputDetails,
  scoreMojibake,
};
