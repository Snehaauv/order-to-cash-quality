import { readFileSync } from 'node:fs';

const parseLine = (line) => {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
};

// Values are not trimmed: whitespace is part of what the rules check.
export const parseCsv = (text) => {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };

  const header = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line, index) => {
    const values = parseLine(line);
    const row = { __line: index + 2 };
    header.forEach((key, i) => {
      row[key] = values[i] ?? '';
    });
    return row;
  });

  return { header, rows };
};

export const readCsv = (path) => parseCsv(readFileSync(path, 'utf8'));
