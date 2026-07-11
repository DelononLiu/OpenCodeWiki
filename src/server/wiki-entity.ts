/**
 * wiki-entity.ts — 实体存储 + CRUD
 *
 * 实体以 .json 文件存储在 .codegraph/wiki/entities/ 下。
 * 每个实体一个文件，按 slug 命名。
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/** 全局实体存储目录（所有项目共享） */
const GLOBAL_ENTITIES_DIR = path.join(os.homedir(), '.opencodewiki', 'entities');

export interface WikiEntityFile {
  /** 文件名（不包含路径） */
  path: string;
  /** 该文件中的相关符号名 */
  symbols: string[];
}

export interface WikiEntityRelation {
  /** 关联的实体 slug */
  target: string;
  /** 关系类型: "depends-on" | "part-of" | "related" */
  type: string;
}

export interface WikiEntity {
  slug: string;
  name: string;
  status: 'draft' | 'reviewed' | 'published';
  definition: string;
  project: string;
  files: WikiEntityFile[];
  relations: WikiEntityRelation[];
  content: string;
  searchCount: number;
}

export class EntityStore {
  constructor(private repoPath?: string) {}

  private get dir(): string {
    // 优先用 ~/.opencodewiki/entities/，没有则用 repoPath 下的
    if (this.repoPath) {
      return path.join(this.repoPath, '.codegraph', 'wiki', 'entities');
    }
    return GLOBAL_ENTITIES_DIR;
  }

  async all(): Promise<WikiEntity[]> {
    try {
      const files = await fs.readdir(this.dir);
      const entities: WikiEntity[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf-8'));
          entities.push(data);
        } catch {}
      }
      return entities;
    } catch {
      return [];
    }
  }

  async get(slug: string): Promise<WikiEntity | null> {
    try {
      const data = await fs.readFile(path.join(this.dir, `${slug}.json`), 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async save(entity: WikiEntity): Promise<void> {
    const dir = this.dir;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${entity.slug}.json`),
      JSON.stringify(entity, null, 2),
      'utf-8',
    );
  }

  async search(query: string): Promise<WikiEntity[]> {
    const all = await this.all();
    const q = query.toLowerCase();
    return all
      .filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.definition.toLowerCase().includes(q) ||
        e.files.some(f => f.path.toLowerCase().includes(q))
      )
      .sort((a, b) => b.searchCount - a.searchCount);
  }

  async hot(limit = 10): Promise<WikiEntity[]> {
    const all = await this.all();
    return all.sort((a, b) => b.searchCount - a.searchCount).slice(0, limit);
  }

  async bump(slug: string): Promise<void> {
    const entity = await this.get(slug);
    if (entity) {
      entity.searchCount++;
      await this.save(entity);
    }
  }
}

// ---------------------------------------------------------------------------
// 实体服务委托（新代码应使用 EntityService 而非 EntityStore）
// ---------------------------------------------------------------------------
import { EntityService } from './entity-service.js';
const entityService = new EntityService();

export function getEntityService(): EntityService {
  return entityService;
}
