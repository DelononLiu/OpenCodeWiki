/**
 * wiki-meta.ts — 知识编排模块：业务模块树 + 代码目录映射
 *
 * 读取仓库根目录的 wiki_meta.json，提供人工定义业务模块的能力。
 * 当 wiki_meta.json 不存在时，回退到当前按代码目录自动生成的方式。
 */

import fs from 'fs';
import path from 'path';

/** 一个业务模块定义 */
export interface BizModule {
  name: string;
  slug: string;
  order: number;
  paths: string[];
}

/** wiki_meta.json 顶层结构 */
export interface WikiMeta {
  modules: BizModule[];
}

/** 模块树节点（与 ModuleTreeNode 兼容） */
export interface ModuleTreeNode {
  name: string;
  slug: string;
  files: string[];
  dependencies?: string[];
  dependents?: string[];
  children?: ModuleTreeNode[];
}

/**
 * 从仓库根目录加载 wiki_meta.json。
 * 文件不存在时返回 null。
 */
export function loadWikiMeta(repoPath: string): WikiMeta | null {
  const metaPath = path.join(repoPath, 'wiki_meta.json');
  try {
    if (!fs.existsSync(metaPath)) return null;
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const meta: WikiMeta = JSON.parse(raw);
    // 验证基础结构
    if (!Array.isArray(meta.modules)) return null;
    for (const mod of meta.modules) {
      if (!mod.name || !mod.slug || !Array.isArray(mod.paths)) return null;
    }
    return meta;
  } catch {
    return null;
  }
}

/**
 * 根据文件路径查找所属的业务模块。
 * 遍历所有模块的 paths，匹配文件路径前缀。
 */
export function getModuleForFile(meta: WikiMeta, filePath: string): string | null {
  for (const mod of meta.modules) {
    for (const p of mod.paths) {
      const normalizedPath = p.endsWith('/') ? p : p + '/';
      if (filePath.startsWith(normalizedPath) || filePath.startsWith(p)) {
        return mod.slug;
      }
    }
  }
  return null;
}

/**
 * 获取一个业务模块绑定的所有文件路径。
 * 从 paths 列表中收集匹配的文件（由调用方传入文件列表进行匹配）。
 */
export function getFilesForModule(meta: WikiMeta, slug: string, allFiles: string[]): string[] {
  const mod = meta.modules.find(m => m.slug === slug);
  if (!mod) return [];
  return allFiles.filter(f => {
    for (const p of mod.paths) {
      const normalizedPath = p.endsWith('/') ? p : p + '/';
      if (f.startsWith(normalizedPath) || f.startsWith(p)) return true;
    }
    return false;
  });
}

/**
 * 根据 wiki_meta.json 生成模块树。
 * 每个业务模块作为一个树节点，files 由 paths 聚合得到。
 */
export function buildModuleTreeFromMeta(
  meta: WikiMeta,
  allFiles: string[],
  edges: { caller: string; callee: string; cnt: number }[]
): ModuleTreeNode[] {
  const tree: ModuleTreeNode[] = [];
  const fileModuleMap = new Map<string, string>();

  // 建立文件→模块映射
  for (const mod of meta.modules) {
    const files = getFilesForModule(meta, mod.slug, allFiles);
    for (const f of files) {
      fileModuleMap.set(f, mod.slug);
    }
  }

  // 为每个模块计算依赖和被依赖
  const modFileSetMap = new Map<string, Set<string>>();
  for (const mod of meta.modules) {
    const files = getFilesForModule(meta, mod.slug, allFiles);
    modFileSetMap.set(mod.slug, new Set(files));
  }

  for (const mod of meta.modules) {
    const modFiles = modFileSetMap.get(mod.slug) || new Set();
    const depSet = new Set<string>();
    const depBySet = new Set<string>();

    for (const e of edges) {
      if (modFiles.has(e.caller)) {
        for (const [otherSlug, otherFiles] of modFileSetMap) {
          if (otherSlug !== mod.slug && otherFiles.has(e.callee)) {
            depSet.add(otherSlug);
          }
        }
      }
      if (modFiles.has(e.callee)) {
        for (const [otherSlug, otherFiles] of modFileSetMap) {
          if (otherSlug !== mod.slug && otherFiles.has(e.caller)) {
            depBySet.add(otherSlug);
          }
        }
      }
    }

    tree.push({
      name: mod.name,
      slug: mod.slug,
      files: [...modFiles],
      dependencies: [...depSet].sort(),
      dependents: [...depBySet].sort(),
      children: [],
    });
  }

  return tree;
}

/**
 * 当没有 wiki_meta.json 时回退到自动生成。
 * 使用已有的 top-level 目录分组逻辑。
 * 此函数在 wiki-integration.ts 中已存在，此处仅做兼容引用。
 */
export function fallbackModuleTree(
  dirMap: Record<string, string[]>,
  edges: { caller: string; callee: string; cnt: number }[]
): ModuleTreeNode[] {
  const tree: ModuleTreeNode[] = [];
  for (const name of Object.keys(dirMap).sort()) {
    const modFiles = dirMap[name];
    const fileSet = new Set(modFiles);
    const depSet = new Set<string>();
    const depBySet = new Set<string>();

    for (const e of edges) {
      if (fileSet.has(e.caller)) {
        for (const [mName, mFiles] of Object.entries(dirMap)) {
          if (mName !== name && mFiles.includes(e.callee)) { depSet.add(mName); break; }
        }
      }
      if (fileSet.has(e.callee)) {
        for (const [mName, mFiles] of Object.entries(dirMap)) {
          if (mName !== name && mFiles.includes(e.caller)) { depBySet.add(mName); break; }
        }
      }
    }

    tree.push({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      files: modFiles,
      dependencies: [...depSet].sort(),
      dependents: [...depBySet].sort(),
      children: [],
    });
  }
  return tree;
}
