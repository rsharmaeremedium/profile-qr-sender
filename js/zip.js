/* ================= QRGen eremedium — minimal ZIP writer =================
   Store-mode (no compression) ZIP builder — plenty for PNG/SVG bundles
   since PNGs are already compressed. No dependencies.
   Exposes: QRZip.create([{ name, data: Uint8Array|string }, ...]) -> Blob
*/
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function toBytes(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    return data;
  }

  // MS-DOS date/time packing (ZIP's native format)
  function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF; }
  function dosDate(d) { return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF; }

  function create(files) {
    var parts = [], central = [], offset = 0, now = new Date();
    var time = dosTime(now), date = dosDate(now);

    files.forEach(function (f) {
      var name = new TextEncoder().encode(f.name);
      var data = toBytes(f.data);
      var crc = crc32(data);

      // Local file header
      var lh = new Uint8Array(30 + name.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);       // signature
      lv.setUint16(4, 20, true);               // version needed
      lv.setUint16(6, 0x0800, true);           // UTF-8 file names
      lv.setUint16(8, 0, true);                // method: stored
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);     // compressed size
      lv.setUint32(22, data.length, true);     // uncompressed size
      lv.setUint16(26, name.length, true);
      lh.set(name, 30);
      parts.push(lh, data);

      // Central directory record
      var ch = new Uint8Array(46 + name.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);       // signature
      cv.setUint16(4, 20, true);               // version made by
      cv.setUint16(6, 20, true);               // version needed
      cv.setUint16(8, 0x0800, true);           // UTF-8 names
      cv.setUint16(10, 0, true);               // method: stored
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);          // local header offset
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + data.length;
    });

    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);

    // End of central directory
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);         // signature
    ev.setUint16(8, files.length, true);       // entries on this disk
    ev.setUint16(10, files.length, true);      // total entries
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(parts.concat(central).concat([eocd]), { type: 'application/zip' });
  }

  global.QRZip = { create: create };
})(window);
