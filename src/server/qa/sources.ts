/**
 * 源码引用解析模块。
 *
 * 从 LLM 回答中提取 file:line 引用，读取磁盘源码片段。
 * 所有三种模式（LLM / ACP / LangGraph）共用。
 */

import fs from 'fs/promises';
import path from 'path';

const FILE_REF_RE = /([\w./-]+(?:\.[a-zA-Z][\w.-]*)):(\d+)(?:-(\d+))?/g;
const CROSS_REPO_FILE_REF_RE = /([\w-]+):([\w./-]+\.[a-zA-Z][\w.-]*):(\d+)(?:-(\d+))?/g;

export function extractFileRefs(text: string): { fileName: string; filePath: string; startLine: number; endLine: number }[] {
  const refs: { fileName: string; filePath: string; startLine: number; endLine: number }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  FILE_REF_RE.lastIndex = 0;
  while ((m = FILE_REF_RE.exec(text)) !== null) {
    const filePath = m[1];
    const fileName = filePath.split('/').pop() || filePath;
    const startLine = parseInt(m[2], 10);
    const endLine = m[3] ? parseInt(m[3], 10) : startLine;
    const key = fileName + ':' + startLine;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ fileName, filePath, startLine, endLine });
    }
  }
  return refs;
}

async function findFileByBasename(dir: string, basename: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === basename) return fullPath;
      if (entry.isDirectory()) {
        const found = await findFileByBasename(fullPath, basename);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

export async function resolveAnswerSources(
  content: string,
  existingSources: any[],
  repoBase: string | null,
  repoBases?: Map<string, string>,
): Promise<any[]> {
  if (repoBases) {
    return resolveCrossRepoSources(content, existingSources, repoBases);
  }
  const refs = extractFileRefs(content);
  if (!repoBase || refs.length === 0) return existingSources;

  const merged = [...existingSources];
  const existingKeys = new Set<string>();
  for (const s of existingSources) {
    const k = s.fileName + ':' + (s.startLine ?? '');
    existingKeys.add(k);
  }

  let refId = existingSources.length;
  for (const ref of refs) {
    const key = ref.fileName + ':' + ref.startLine;
    if (existingKeys.has(key)) continue;

    const candidatePaths = [
      path.join(repoBase, ref.filePath),
      path.join(repoBase, ref.fileName),
      path.join(repoBase, 'src', ref.fileName),
      path.join(repoBase, 'lib', ref.fileName),
    ];
    let snippet = '';
    let filePath = '';
    for (const cp of candidatePaths) {
      try {
        const stat = await fs.stat(cp);
        if (stat.isFile()) {
          filePath = cp;
          const srcContent = await fs.readFile(cp, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
          break;
        }
      } catch {}
    }
    if (!snippet) {
      const found = await findFileByBasename(repoBase, ref.fileName);
      if (found) {
        try {
          filePath = found;
          const srcContent = await fs.readFile(found, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
        } catch {}
      }
    }
    if (!snippet) continue;

    existingKeys.add(key);
    merged.push({
      filePath: filePath ? path.relative(repoBase, filePath) : ref.fileName,
      label: 'File',
      startLine: ref.startLine,
      endLine: ref.endLine,
      fileName: ref.fileName,
      snippet,
      refId: refId++,
    });
  }
  return merged;
}

async function resolveCrossRepoSources(
  content: string,
  existingSources: any[],
  repoBases: Map<string, string>,
): Promise<any[]> {
  const refs: { repoName: string; fileName: string; filePath: string; startLine: number; endLine: number }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  CROSS_REPO_FILE_REF_RE.lastIndex = 0;
  while ((m = CROSS_REPO_FILE_REF_RE.exec(content)) !== null) {
    const repoName = m[1];
    const filePath = m[2];
    const fileName = filePath.split('/').pop() || filePath;
    const startLine = parseInt(m[3], 10);
    const endLine = m[4] ? parseInt(m[4], 10) : startLine;
    const key = repoName + ':' + fileName + ':' + startLine;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ repoName, fileName, filePath, startLine, endLine });
    }
  }

  if (refs.length === 0) return existingSources;

  const merged = [...existingSources];
  const existingKeys = new Set<string>();
  for (const s of existingSources) {
    const k = (s.repo ?? '') + ':' + s.fileName + ':' + (s.startLine ?? '');
    existingKeys.add(k);
  }

  let refId = existingSources.length;
  for (const ref of refs) {
    const key = ref.repoName + ':' + ref.fileName + ':' + ref.startLine;
    if (existingKeys.has(key)) continue;

    const repoBase = repoBases.get(ref.repoName);
    if (!repoBase) continue;

    const candidatePaths = [
      path.join(repoBase, ref.filePath),
      path.join(repoBase, ref.fileName),
      path.join(repoBase, 'src', ref.fileName),
      path.join(repoBase, 'lib', ref.fileName),
    ];
    let snippet = '';
    let filePath = '';
    for (const cp of candidatePaths) {
      try {
        const stat = await fs.stat(cp);
        if (stat.isFile()) {
          filePath = cp;
          const srcContent = await fs.readFile(cp, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
          break;
        }
      } catch {}
    }
    if (!snippet) {
      const found = await findFileByBasename(repoBase, ref.fileName);
      if (found) {
        try {
          filePath = found;
          const srcContent = await fs.readFile(found, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
        } catch {}
      }
    }
    if (!snippet) continue;

    existingKeys.add(key);
    merged.push({
      repo: ref.repoName,
      filePath: ref.repoName + ':' + (filePath ? path.relative(repoBase, filePath) : ref.fileName),
      label: 'File',
      startLine: ref.startLine,
      endLine: ref.endLine,
      fileName: ref.repoName + ':' + ref.fileName,
      snippet,
      refId: refId++,
    });
  }
  return merged;
}
