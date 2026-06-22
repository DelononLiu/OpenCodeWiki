/**
 * cbm-bridge.ts — codebase-memory-mcp 桥接层
 *
 * 替代 @colbymchenry/codegraph 的 ToolHandler，通过 execSync 调用
 * codebase-memory-mcp 的 CLI 接口。接口签名与旧的 handler.execute() 兼容。
 *
 * 使用方式:
 *   const bridge = new CbmBridge();
 *   const result = await bridge.execTool('search_graph', { query: 'foo', project: 'my-proj' });
 *
 * 项目名推导（codebase-memory-mcp 内部使用）:
 *   /home/user/repo → home-user-repo  （去掉首 /，替换 / 为 -）
 */

import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import os from 'os';

// ── 常量 ──────────────────────────────────────────────────────────

const BINARY_NAME = 'codebase-memory-mcp';
const TIMEOUT_DEFAULT = 30_000;  // 普通查询 30s
const TIMEOUT_INDEX = 300_000;   // 索引操作 5min

// ── 工具映射表 ─────────────────────────────────────────────────────

/** codegraph 旧 tool 名 → codebase-memory-mcp CLI 命令 */
const TOOL_MAP: Record<string, string> = {
  'codegraph_search':   'search_graph',
  'codegraph_context':  'get_code_snippet',
  'codegraph_callers':  'trace_path',
  'codegraph_callees':  'trace_path',
  'codegraph_impact':   'trace_path',
  'codegraph_status':   'index_status',
  'codegraph_node':     'get_code_snippet',
  'codegraph_explore':  'search_code',
  'codegraph_files':    'search_graph',
};

/** 需要较长超时的操作 */
const INDEX_TOOLS = new Set(['index_repository', 'index_status']);

// ── 类型 ──────────────────────────────────────────────────────────

export interface CbmToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

// ── CbmBridge ──────────────────────────────────────────────────────

export class CbmBridge {
  private binaryPath: string;
  private binaryChecked = false;
  private binaryAvailable = false;

  constructor(
    /** 当前项目（OpenCodeWiki 自身）的根目录，用于 self-repo 默认 project */
    private selfRepoPath?: string,
  ) {
    this.binaryPath = CbmBridge.resolveBinary();
  }

  // ═════════════════════════════════════════════════════════════
  //  静态工具
  // ═════════════════════════════════════════════════════════════

  /**
   * 从绝对路径推导 codebase-memory-mcp 项目名。
   * /home/user/repo → home-user-repo
   */
  static repoPathToProjectName(repoPath: string): string {
    return repoPath.replace(/^\//, '').replace(/\//g, '-');
  }

  /** 解析二进制路径：PATH → ~/.codebase-memory/bin → 已知路径 */
  static resolveBinary(): string {
    // 1. 检查 PATH
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, BINARY_NAME);
      try {
        execFileSync(candidate, ['--version'], { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 });
        return candidate;
      } catch { continue; }
    }
    // 2. 检查 ~/.codebase-memory/bin/
    const homeBin = path.join(os.homedir(), '.codebase-memory', 'bin', BINARY_NAME);
    try {
      execFileSync(homeBin, ['--version'], { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 });
      return homeBin;
    } catch {}
    // 3. fallback: 直接返回名称（让 execFileSync 抛错，由上层处理）
    return BINARY_NAME;
  }

  /**
   * 检查二进制是否可用，项目是否已索引。
   * 返回 { available: boolean, indexed: boolean, nodes?: number, edges?: number }
   */
  static async healthCheck(projectName?: string): Promise<{
    available: boolean;
    indexed: boolean;
    nodes?: number;
    edges?: number;
    error?: string;
  }> {
    const binary = CbmBridge.resolveBinary();
    let available = false;
    try {
      execFileSync(binary, ['--version'], { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 });
      available = true;
    } catch {
      return { available: false, indexed: false, error: 'Binary not found' };
    }

    if (!projectName) return { available: true, indexed: false };

    try {
      const out = execFileSync(binary, ['cli', 'index_status', JSON.stringify({ project: projectName })], {
        encoding: 'utf-8', timeout: TIMEOUT_DEFAULT,
      });
      const jsonLine = out.trim().split('\n').filter(l => l.startsWith('{')).pop() || '{}';
      const data = JSON.parse(jsonLine);
      if (data.status === 'ready') {
        return { available: true, indexed: true, nodes: data.nodes, edges: data.edges };
      }
      return { available: true, indexed: false };
    } catch {
      return { available: true, indexed: false };
    }
  }

  // ═════════════════════════════════════════════════════════════
  //  核心执行
  // ═════════════════════════════════════════════════════════════

  /**
   * 统一调用入口。签名与旧的 handler.execute() 兼容。
   *
   * @param tool  工具名（兼容旧的 codegraph_xxx 名称）
   * @param args  参数字典
   */
  async execTool(tool: string, args: Record<string, any> = {}): Promise<CbmToolResult> {
    return this._exec(tool, args);
  }

  /** 别名，与旧的 handler.execute(tool, args) 签名兼容 */
  async execute(tool: string, args: Record<string, any> = {}): Promise<CbmToolResult> {
    return this._exec(tool, args);
  }

  private async _exec(tool: string, args: Record<string, any> = {}): Promise<CbmToolResult> {
    const cbmTool = this.resolveTool(tool);
    const cbmArgs = this.mapArgs(cbmTool, args);
    const timeout = INDEX_TOOLS.has(cbmTool) ? TIMEOUT_INDEX : TIMEOUT_DEFAULT;

    const cliArgs = ['cli', cbmTool, JSON.stringify(cbmArgs)];

    try {
      const result = spawnSync(this.binaryPath, cliArgs, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // spawnSync 内部错误（ENOENT 等），不抛异常而是通过 error 属性返回
      if (result.error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: result.error.message || String(result.error),
            tool: cbmTool,
          }) }],
          isError: true,
        };
      }

      if (result.status !== 0) {
        // 非零退出 — 合并 stdout + stderr 错误信息
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        const lines = stdout.split('\n').filter(l => l.startsWith('{'));
        const jsonStr = lines.pop() || '{}';
        let errData: any;
        try { errData = JSON.parse(jsonStr); } catch { errData = { stdout: jsonStr }; }
        if (stderr && !errData.error) errData.error = stderr;
        if (!errData.error) errData.error = `Exit code ${result.status}`;
        return {
          content: [{ type: 'text', text: JSON.stringify(errData) }],
          isError: true,
        };
      }

      // 过滤非 JSON 日志行，取最后一行 JSON
      const stdoutTrim = (result.stdout || '').trim();
      const lines = stdoutTrim.split('\n').filter(l => l.startsWith('{'));
      const jsonStr = lines.pop() || '{}';

      return { content: [{ type: 'text', text: jsonStr }] };

    } catch (err: any) {
      const errMsg = err?.message || String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: errMsg, tool: cbmTool }) }],
        isError: true,
      };
    }
  }

  /**
   * 检查二进制是否可用。
   * @param forceRecheck 设为 true 时忽略缓存，重新检测
   */
  isAvailable(forceRecheck = false): boolean {
    if (forceRecheck || !this.binaryChecked) {
      try {
        execFileSync(this.binaryPath, ['--version'], { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 });
        this.binaryAvailable = true;
      } catch {
        this.binaryAvailable = false;
      }
      this.binaryChecked = true;
    }
    return this.binaryAvailable;
  }

  // ═════════════════════════════════════════════════════════════
  //  参数映射
  // ═════════════════════════════════════════════════════════════

  /** 解析 tool 名（兼容旧名称）*/
  private resolveTool(tool: string): string {
    return TOOL_MAP[tool] || tool;
  }

  /** 将 OpenCodeWiki 旧参数风格映射为 codebase-memory-mcp 参数 */
  private mapArgs(tool: string, args: Record<string, any>): Record<string, any> {
    const mapped: Record<string, any> = { ...args };

    // 1. projectPath → project（路径转项目名）
    if (mapped.projectPath) {
      mapped.project = CbmBridge.repoPathToProjectName(mapped.projectPath);
      delete mapped.projectPath;
    } else if (this.selfRepoPath && !mapped.project) {
      // 没有传 project 时默认 self repo（兼容旧行为）
      mapped.project = CbmBridge.repoPathToProjectName(this.selfRepoPath);
    }

    // 2. 工具特定参数映射
    switch (tool) {
      case 'search_graph':
        // maxResults → limit
        if (mapped.maxResults !== undefined) {
          mapped.limit = mapped.maxResults;
          delete mapped.maxResults;
        }
        // 如果同时有 query 和 name_pattern，按 name_pattern 优先级更高
        break;

      case 'trace_path':
        // symbol → function_name
        if (mapped.symbol) {
          mapped.function_name = mapped.symbol;
          delete mapped.symbol;
        }
        // 默认 both 方向
        if (!mapped.direction) mapped.direction = 'both';
        break;

      case 'get_code_snippet':
        // symbol → 尝试放 qualified_name（如果之前有 search 结果的话）
        // 注意：get_code_snippet 优先使用 qualified_name 参数
        if (mapped.symbol && !mapped.qualified_name) {
          mapped.qualified_name = mapped.symbol;
          delete mapped.symbol;
        }
        break;

      case 'search_code':
        // query → pattern
        if (mapped.query && !mapped.pattern) {
          mapped.pattern = mapped.query;
          delete mapped.query;
        }
        break;

      case 'index_repository':
        // projectPath → repo_path
        if (mapped.projectPath) {
          mapped.repo_path = mapped.projectPath;
          delete mapped.projectPath;
        }
        if (mapped.project && !mapped.repo_path) {
          // 反向映射：有 project name 但没有 repo_path 时忽略（index_repository 需要路径）
          // 这种情况不应该发生，但不会阻止调用
        }
        break;

      case 'index_status':
        // 已通过 projectPath → project 映射，无需额外处理
        break;
    }

    // 清理可能残留的旧参数
    delete mapped.projectPath;

    return mapped;
  }
}

// ── 单例工厂 ──────────────────────────────────────────────────────

let _bridge: CbmBridge | null = null;

/**
 * 获取共享 CbmBridge 实例（应用启动时设置 selfRepoPath）。
 * 供 cbm-bridge 和 qa-resolver 使用。
 */
export function getBridge(selfRepoPath?: string): CbmBridge {
  if (!_bridge) {
    _bridge = new CbmBridge(selfRepoPath);
  }
  return _bridge;
}

/** 测试用：重置单例 */
export function resetBridge(): void {
  _bridge = null;
}

// ═════════════════════════════════════════════════════════════
//  服务启动
// ═════════════════════════════════════════════════════════════

/**
 * 启动 Express 服务。作为主入口运行时自动调用。
 *
 * 动态导入 server.ts（内部管理 Express 路由和 app.listen），
 * 使其在导入时自动完成服务器初始化和监听。
 *
 * 这替代了server.ts 作为入口点的角色，实现
 * cbm-bridge → server 的单向依赖关系。
 */
export async function startServer(): Promise<void> {
  console.log('[cbm-bridge] Starting OpenCodeWiki server...');
  await import('./server.js');
}

// ── 主入口检测 ──────────────────────────────────────────────

const entryFile = process.argv[1] || '';
const isMainEntry =
  entryFile.endsWith('cbm-bridge.ts') ||
  entryFile.endsWith('cbm-bridge.js') ||
  entryFile.endsWith('/cbm-bridge.ts') ||
  entryFile.endsWith('/cbm-bridge.js');

if (isMainEntry) {
  startServer().catch(err => {
    console.error('[cbm-bridge] Failed to start server:', err);
    process.exit(1);
  });
}
