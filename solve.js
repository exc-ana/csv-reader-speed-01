// Fast drop-in replacement for csv-reader 1.0.0 (make.fun).
// run(input) returns exactly what csv-reader's readCsv returns for {text, header}:
// {columns, rows, errors} with the same broken-row policy. Written from the
// reference semantics in the kit (baselines/csv-reader/vendor/csv-reader/index.js).
//
// Speed strategy: never read one character at a time. Fields are cut out with
// String.indexOf / String.slice (C++ scans) and only re-scanned character-wise
// on the rare paths that need it (stray CRs, line breaks inside quotes). A whole
// line with no quotes and no stray CR is split at once. ended codes:
// 0 = comma, 1 = line break, 2 = end of text.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;

  // The record being read (for error records).
  let recLine = 1;
  let recRow = null;

  // Scratch outputs of the field readers.
  let fVal;
  let fEnd;
  let fAdd;

  // Read an unquoted field starting at p with initial value v0.
  // Updates pos/line. Sets fVal (value), fEnd, fAdd (chars kept).
  function unq(p, v0) {
    let value = v0;
    let added = 0;
    for (;;) {
      // Fast lane: the field ends at the next comma, and the stretch to it
      // holds no CR or LF, so it is the whole field as it stands.
      const comma = text.indexOf(',', p);
      if (comma !== -1) {
        const seg = text.slice(p, comma);
        if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
          value += seg;
          added += seg.length;
          pos = comma + 1;
          fVal = value;
          fEnd = 0;
          fAdd = added;
          return;
        }
      }
      // General lane: nearest of comma / LF / CR, or the end of the text.
      const lf = text.indexOf('\n', p);
      let end;
      let isComma;
      if (comma !== -1 && (lf === -1 || comma < lf)) {
        end = comma;
        isComma = true;
      } else if (lf !== -1) {
        end = lf;
        isComma = false;
      } else {
        end = n;
        isComma = false;
      }
      const seg = text.slice(p, end);
      const r = seg.indexOf('\r');
      if (r === -1) {
        value += seg;
        added += seg.length;
        if (isComma) {
          pos = end + 1;
          fVal = value;
          fEnd = 0;
          fAdd = added;
          return;
        }
        if (end === n) {
          pos = n;
          fVal = value;
          fEnd = 2;
          fAdd = added;
          return;
        }
        pos = end + 1;
        line += 1;
        fVal = value;
        fEnd = 1;
        fAdd = added;
        return;
      }
      if (!isComma && end !== n && r === seg.length - 1) {
        // The segment's only CR sits right before the LF: a CRLF line break.
        value += seg.slice(0, -1);
        added += seg.length - 1;
        pos = end + 1;
        line += 1;
        fVal = value;
        fEnd = 1;
        fAdd = added;
        return;
      }
      // A stray CR hides in this field: re-scan it exactly (rare).
      let q = p;
      for (;;) {
        const c = text.charCodeAt(q);
        if (c === 44) {
          value += text.slice(p, q);
          added += q - p;
          pos = q + 1;
          fVal = value;
          fEnd = 0;
          fAdd = added;
          return;
        }
        if (c === 10) {
          value += text.slice(p, q);
          added += q - p;
          pos = q + 1;
          line += 1;
          fVal = value;
          fEnd = 1;
          fAdd = added;
          return;
        }
        if (c === 13) {
          if (text.charCodeAt(q + 1) === 10) {
            value += text.slice(p, q);
            added += q - p;
            pos = q + 2;
            line += 1;
            fVal = value;
            fEnd = 1;
            fAdd = added;
            return;
          }
          errors.push({ code: 'stray_cr', line: recLine, row: recRow });
          value += text.slice(p, q);
          added += q - p;
          p = q + 1;
          q = p;
          continue;
        }
        if (q >= n) {
          value += text.slice(p);
          added += n - p;
          pos = n;
          fVal = value;
          fEnd = 2;
          fAdd = added;
          return;
        }
        q += 1;
      }
    }
  }

  // A quoted segment [p, q): CRLF and lone CR each read as one LF, lines counted.
  function seg(p, q) {
    const s = text.slice(p, q);
    if (s.indexOf('\r') === -1 && s.indexOf('\n') === -1) return s;
    return s.replace(/\r\n|\r|\n/g, () => {
      line += 1;
      return '\n';
    });
  }

  // Read a quoted field; pos is at the opening quote. Sets fVal/fEnd.
  function quo() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
        pos = open + 1;
        line = openLine;
        unq(open + 1, '"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field.
        value += seg(p, q);
        value += '"';
        p = q + 2;
        continue;
      }
      value += seg(p, q);
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      fVal = value;
      fEnd = 2;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fVal = value;
      fEnd = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fVal = value;
      fEnd = 1;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = value;
      fEnd = 1;
      return;
    }
    // What follows the closing quote is appended as it stands.
    unq(pos, value);
    if (fAdd > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;
    let fields;
    let quoted = false;

    // Fast lane: a line with no quote and no stray CR is plain comma fields.
    // (Check for a quote before slicing the line, so quote-heavy lines pay
    // no allocation for a slice the fast lane then throws away.)
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? n : lf;
    const qm = text.indexOf('"', pos);
    if (qm === -1 || qm >= lineEnd) {
      const lineStr = text.slice(pos, lineEnd);
      const r = lineStr.indexOf('\r');
      if (r === -1) {
        fields = lineStr.split(',');
        pos = lf === -1 ? n : lf + 1;
        if (lf !== -1) line += 1;
      } else if (r === lineStr.length - 1 && lf !== -1) {
        // One CR at the very end, right before the LF: a CRLF line break.
        fields = lineStr.slice(0, -1).split(',');
        pos = lf + 1;
        line += 1;
      }
    }

    if (fields === undefined) {
      fields = [];
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) quo();
        else unq(pos, '');
        fields.push(fVal);
      } while (fEnd === 0);
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
