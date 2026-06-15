/**
 * Log file error analyzer.
 * Extracts errors/anomalies from log files and produces a compact summary
 * suitable for injection into LLM/ACP prompts without overflowing context.
 */
import * as fs from 'fs/promises';

export interface ErrorMatch {
  lineNumber: number;
  text: string;
  name: string;
  severity: 'fatal' | 'error' | 'warning';
  context: string;
}

export interface ExtractErrorsResult {
  total: number;
  extracted: number;
  severityCounts: { fatal: number; error: number; warning: number };
  errors: ErrorMatch[];
  summary: string;
}

// Error patterns ordered by severity
const PATTERNS: { name: string; re: RegExp; severity: 'fatal' | 'error' | 'warning' }[] = [
  // Fatal / crash
  { name: 'FATAL', re: /\b(FATAL|SEGV|SIGSEGV|PANIC|KILLED|OOM|OutOfMemory)\b/i, severity: 'fatal' },
  { name: 'Stack Trace', re: /^\s*at\s+.*\(.*\.(java|kt|scala|tsx?|jsx?|py|go|rs):\d+\)/i, severity: 'error' },
  { name: 'Caused by', re: /^Caused by:\s+\w+Exception/i, severity: 'error' },
  { name: 'Traceback', re: /^(Traceback|File ".*".*line \d+)/i, severity: 'error' },
  { name: 'ERROR', re: /\b(ERROR|CRITICAL|SEVERE|FATAL)\b/i, severity: 'error' },
  { name: 'Exception', re: /(Exception|Error|Throwable)(?!\s*\))/i, severity: 'error' },
  { name: 'Failed', re: /\b(failed|failure|unsuccessful)\b/i, severity: 'error' },
  { name: 'Timeout', re: /\b(timeout|timed?\s*out|deadline exceeded)\b/i, severity: 'error' },
  { name: 'Connection', re: /\b(connection refused|ECONNREFUSED|connection reset|ECONNRESET|broken pipe|EPIPE)\b/i, severity: 'error' },
  { name: 'Null/Undefined', re: /\b(NullPointer|undefined is not|TypeError|ReferenceError|Cannot read property)\b/i, severity: 'error' },
  { name: 'Permission', re: /\b(permission denied|EACCES|EACCESS|forbidden|403)\b/i, severity: 'error' },
  { name: 'Not Found', re: /\b(not found|ENOENT|module not found|404)\b/i, severity: 'error' },
  { name: 'Assertion', re: /\b(assertion failed|AssertionError|assert)\b/i, severity: 'error' },
  { name: 'WARNING', re: /\b(WARN(ING)?)\b/i, severity: 'warning' },
  { name: 'Deprecated', re: /\b(deprecated|removed|obsolete)\b/i, severity: 'warning' },
];

/**
 * Extract errors from log file content.
 * @param raw - Full file content
 * @param options - Extraction options
 */
export function extractErrors(
  raw: string,
  options: { contextLines?: number; maxErrors?: number; includeWarnings?: boolean } = {},
): ExtractErrorsResult {
  const ctx = options.contextLines ?? 3;
  const maxErrors = options.maxErrors ?? 30;
  const includeWarnings = options.includeWarnings ?? true;

  const allLines = raw.split('\n');
  const total = allLines.length;
  const matches: ErrorMatch[] = [];
  const seenTexts = new Set<string>();

  for (let i = 0; i < allLines.length && matches.length < maxErrors; i++) {
    const line = allLines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    let matched = false;
    for (const p of PATTERNS) {
      if (p.severity === 'warning' && !includeWarnings) continue;
      if (!p.re.test(trimmed)) continue;

      // Dedup by first 80 chars
      const dedupKey = trimmed.slice(0, 80).toLowerCase();
      if (seenTexts.has(dedupKey)) break;
      seenTexts.add(dedupKey);

      // Collect following stack trace lines
      let contextEnd = Math.min(allLines.length, i + 1 + ctx);
      for (let j = i + 1; j < allLines.length && j < i + 1 + 20; j++) {
        const t = allLines[j].trim();
        if (!t || t.startsWith('at ') || t.startsWith('\t') || t.startsWith('... ') || t.startsWith('^')) {
          contextEnd = j + 1;
        } else break;
      }

      const ctxStart = Math.max(0, i - ctx);
      const context = allLines.slice(ctxStart, contextEnd)
        .map((l, j) => `${ctxStart + j + 1}: ${l}`).join('\n');

      matches.push({
        lineNumber: i + 1,
        text: trimmed.slice(0, 200),
        name: p.name,
        severity: p.severity,
        context,
      });
      matched = true;
      break;
    }

    // Skip stack trace continuation lines
    if (matched) {
      while (i + 1 < allLines.length) {
        const t = allLines[i + 1].trim();
        if (t.startsWith('at ') || t.startsWith('\t') || t.startsWith('... ') || t.startsWith('^')) i++;
        else break;
      }
    }
  }

  const counts = { fatal: 0, error: 0, warning: 0 };
  for (const m of matches) counts[m.severity]++;

  const errCount = counts.fatal + counts.error;
  return {
    total,
    extracted: matches.length,
    severityCounts: counts,
    errors: matches,
    summary: matches.length > 0
      ? `Found ${errCount} errors (${counts.fatal} fatal, ${counts.error} error${counts.warning ? `, ${counts.warning} warning` : ''}) in ${total} lines.`
      : `No errors found in ${total} lines. The log appears clean.`,
  };
}

/**
 * Build a compact prompt fragment from error extraction results.
 * Suitable for injection into LLM/ACP context without overflowing.
 */
export function buildErrorPromptFragment(
  fileName: string,
  result: ExtractErrorsResult,
  maxLines = 80,
): string {
  const lines: string[] = [];
  lines.push(`File: ${fileName} (${result.total} lines, ${result.extracted} issues found)`);
  lines.push(`Summary: ${result.summary}`);
  lines.push('');

  // Include top errors (fatal first, then error, limiting total lines)
  let lineCount = 0;
  const sorted = [...result.errors].sort((a, b) => {
    const sev = { fatal: 0, error: 1, warning: 2 };
    return sev[a.severity] - sev[b.severity];
  });

  for (const err of sorted) {
    if (lineCount >= maxLines) break;
    const ctxLines = err.context.split('\n');
    if (lineCount + ctxLines.length + 1 > maxLines) {
      // Truncate context
      const remaining = maxLines - lineCount - 1;
      const truncatedCtx = ctxLines.slice(0, Math.max(1, remaining));
      lines.push(`[${err.severity.toUpperCase()}] L${err.lineNumber} ${err.name}: ${err.text}`);
      lines.push(...truncatedCtx.map(l => '  ' + l));
      lineCount += truncatedCtx.length + 1;
    } else {
      lines.push(`[${err.severity.toUpperCase()}] L${err.lineNumber} ${err.name}: ${err.text}`);
      lines.push(...ctxLines.map(l => '  ' + l));
      lineCount += ctxLines.length + 1;
    }
  }

  return lines.join('\n');
}
