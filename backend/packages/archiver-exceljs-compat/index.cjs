'use strict';

const { PassThrough } = require('node:stream');
const upstream = require('archiver-upstream');

function createArchive(format, options) {
  const archive = format === 'zip'
    ? new upstream.ZipArchive(options)
    : format === 'tar'
      ? new upstream.TarArchive(options)
      : format === 'json'
        ? new upstream.JsonArchive(options)
        : null;

  if (!archive) throw new Error(`Unsupported archive format: ${format}`);

  // ExcelJS 4.x passes its own StreamBuf implementation. Archiver 8 validates
  // inputs using Node stream semantics, so bridge that legacy stream without
  // buffering the complete worksheet in memory.
  const append = archive.append.bind(archive);
  archive.append = (source, entry) => {
    if (!Buffer.isBuffer(source) && source && typeof source.pipe === 'function') {
      const bridge = new PassThrough();
      source.pipe(bridge);
      return append(bridge, entry);
    }
    return append(source, entry);
  };

  return archive;
}

Object.assign(createArchive, upstream);
module.exports = createArchive;
