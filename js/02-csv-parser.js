/* Dis bagimliliksiz CSV stream parser. Buyuk dosyalari chunk chunk okur,
   quoted alanlar icindeki virgul/newline/escaped-quote durumlarini dogru
   isler. PapaParse'a olan bagimliligi tamamen ortadan kaldirir (worker
   olusturma CSP sorunlarindan kacinmak icin). */

function parseCsvFile(file, { onRow, onProgress, chunkSizeBytes = 8 * 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8');
    let offset = 0;
    let buffer = '';
    let header = null;

    function processBuffer(isFinal) {
      let i = 0;
      let fields = [];
      let currentField = '';
      let inQuotes = false;
      let lastRowEnd = 0;
      const buf = buffer;
      const n = buf.length;

      function emitRow() {
        if (header === null) {
          header = fields;
        } else {
          const obj = {};
          for (let k = 0; k < header.length; k++) obj[header[k]] = fields[k] !== undefined ? fields[k] : '';
          onRow(obj);
        }
      }

      while (i < n) {
        const ch = buf[i];
        if (inQuotes) {
          if (ch === '"') {
            if (i + 1 < n && buf[i + 1] === '"') { currentField += '"'; i += 2; continue; }
            if (i + 1 >= n && !isFinal) break; // sinirin ucunda belirsiz durum, daha fazla veri bekle
            inQuotes = false; i += 1; continue;
          }
          currentField += ch; i += 1; continue;
        } else {
          if (ch === '"') { inQuotes = true; i += 1; continue; }
          if (ch === ',') { fields.push(currentField); currentField = ''; i += 1; continue; }
          if (ch === '\r') { i += 1; continue; }
          if (ch === '\n') {
            fields.push(currentField);
            emitRow();
            fields = []; currentField = '';
            i += 1;
            lastRowEnd = i;
            continue;
          }
          currentField += ch; i += 1; continue;
        }
      }

      if (isFinal) {
        if (currentField !== '' || fields.length > 0) {
          fields.push(currentField);
          emitRow();
        }
        buffer = '';
      } else {
        buffer = buf.slice(lastRowEnd);
      }
    }

    async function readNextChunk() {
      if (offset >= file.size) {
        buffer += decoder.decode(); // decoder'da kalan bayt varsa flush et
        processBuffer(true);
        resolve();
        return;
      }
      try {
        const slice = file.slice(offset, offset + chunkSizeBytes);
        const arrayBuffer = await slice.arrayBuffer();
        const text = decoder.decode(arrayBuffer, { stream: true });
        buffer += text;
        offset += chunkSizeBytes;
        processBuffer(false);
        if (onProgress) onProgress(Math.min(offset, file.size));
        // UI'nin nefes almasi icin bir tick birakiyoruz
        setTimeout(readNextChunk, 0);
      } catch (err) {
        reject(err);
      }
    }

    readNextChunk();
  });
}



// ---------------- streaming wrapper (custom CSV parser, PapaParse YOK) ----------------

function parseStream(file, onRow, onProgressBytes) {
  return parseCsvFile(file, { onRow, onProgress: onProgressBytes });
}

