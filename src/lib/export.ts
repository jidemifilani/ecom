/**
 * CSV export.
 *
 * Two things matter here beyond joining strings:
 *  * RFC-4180 quoting, so a product description containing a comma, a quote or
 *    a newline cannot shift every later column.
 *  * Formula injection defence. A cell starting with =, +, -, @, tab or CR is
 *    executed as a formula by Excel and Google Sheets when the file is opened.
 *    Those values are prefixed with a tab so they are read as text. This is the
 *    difference between exporting a product name and shipping a spreadsheet
 *    that runs a command on a colleague's machine.
 */

const DANGEROUS_LEAD = /^[=+\-@\t\r]/;

export const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'boolean') {
    text = value ? 'Yes' : 'No';
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  if (DANGEROUS_LEAD.test(text)) {
    text = `\t${text}`;
  }

  if (/[",\n\r\t]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

export const toCsv = <T,>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string => {
  const lines: string[] = [columns.map((column) => escapeCsvValue(column.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvValue(column.value(row))).join(','));
  }

  // CRLF is what Excel expects; a BOM makes it read the file as UTF-8 so
  // non-ASCII names and currency symbols survive the round trip.
  return `﻿${lines.join('\r\n')}\r\n`;
};

export const csvResponse = (filename: string, body: string): Response => {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
};

/** `orders-2026-11-04.csv` */
export const timestampedFilename = (base: string): string => {
  const date = new Date().toISOString().slice(0, 10);
  return `${base}-${date}.csv`;
};
