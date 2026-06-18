import { spawn, execSync, ChildProcess } from 'child_process';
import { Writable, Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

export interface AgentProcess {
  process: ChildProcess;
  input: WritableStream<Uint8Array>;
  output: ReadableStream<Uint8Array>;
}

/**
 * Known ACP-compatible agents and their default commands.
 */
export const ACP_AGENTS = {
  kilo: {
    command: 'kilo',
    args: (cwd: string) => ['acp', '--port', '0', '--cwd', cwd],
    env: {} as Record<string, string>,
  },
  claude: {
    command: 'claude-agent-acp',
    args: (_cwd: string) => [],  // uses stdin/stdout ndjson, no CLI args needed
    env: {} as Record<string, string>,
  },
} as const;

export type AcpAgentType = keyof typeof ACP_AGENTS;

function log(level: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [acp] [manager] [' + level + '] ' + line);
}

/** Resolve a command to its absolute path, searching PATH and common locations. */
function resolveCommand(command: string): string {
  // If it's already an absolute path, use it directly
  if (command.startsWith('/') || command.startsWith('./')) {
    if (fs.existsSync(command)) return command;
    return command;
  }

  // Try which/where
  try {
    const resolved = execSync(`which "${command}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (resolved) return resolved;
  } catch {
    // Not on PATH
  }

  // Try common locations for npx-installed packages
  const home = process.env.HOME || '/home/user';
  const commonPaths = [
    path.join(home, 'node_modules', '.bin', command),
    path.join(home, '.nvm', 'versions', 'node', '*', 'bin', command),
    '/usr/local/bin/' + command,
    '/usr/bin/' + command,
  ];

  for (const cp of commonPaths) {
    // Expand glob patterns like ~/.nvm/versions/node/*/bin/claude-agent-acp
    const globIdx = cp.indexOf('*');
    if (globIdx !== -1) {
      const prefix = cp.slice(0, globIdx);
      const suffix = cp.slice(globIdx + 1);
      try {
        const dir = path.dirname(prefix);
        const pattern = path.basename(prefix);
        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir);
          for (const entry of entries.sort().reverse()) {
            const candidate = path.join(dir, entry, suffix);
            if (fs.existsSync(candidate)) return candidate;
          }
        }
      } catch {}
    } else if (fs.existsSync(cp)) {
      return cp;
    }
  }

  return command; // Return original; spawn will fail gracefully
}

export class AgentManager {
  private _childProcess: ChildProcess | null = null;
  private _command = '';

  get command(): string {
    return this._command;
  }

  /**
   * Start an ACP agent subprocess.
   * Resolves the command path, spawns the process, and returns Web Streams.
   *
   * @param command - Agent binary name or path
   * @param args - CLI arguments
   * @param envOverride - Optional env overrides merged with process.env
   */
  async startAgent(command: string, args: string[] = [], envOverride?: Record<string, string>): Promise<AgentProcess> {
    if (this._childProcess) this.stopAgent();

    const resolvedPath = resolveCommand(command);
    this._command = resolvedPath;
    log('info', 'ACP agent ready', { cmd: resolvedPath + (args.length ? ' ' + args.join(' ') : '') });

    const spawnedEnv = { ...process.env, ...envOverride };

    const agentProcess = spawn(resolvedPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnedEnv,
    });

    this._childProcess = agentProcess;

    // Discard agent stderr to avoid noise (e.g. "Session not found")
    agentProcess.stderr?.on('data', () => {});

    // Convert Node.js streams to Web Streams for ACP SDK
    const input = Writable.toWeb(agentProcess.stdin!) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(agentProcess.stdout!) as ReadableStream<Uint8Array>;

    agentProcess.on('exit', (code) => {
      log('info', 'Agent process exited', { code, command });
      this._childProcess = null;
    });

    agentProcess.on('error', (err) => {
      log('error', 'Agent process error', { command, error: err.message });
      this._childProcess = null;
    });

    return { process: agentProcess, input, output };
  }

  /**
   * Start a known ACP agent type by name.
   */
  async startAgentByType(agentType: AcpAgentType, cwd: string): Promise<AgentProcess> {
    const config = ACP_AGENTS[agentType];
    if (!config) {
      throw new Error(`Unknown ACP agent type: "${agentType}". Supported: ${Object.keys(ACP_AGENTS).join(', ')}`);
    }
    return this.startAgent(config.command, config.args(cwd), config.env);
  }

  /** Convenience: start Kilo ACP agent. */
  async startKiloAgent(workspacePath: string): Promise<AgentProcess> {
    return this.startAgentByType('kilo', workspacePath);
  }

  /** Convenience: start Claude Code ACP agent. */
  async startClaudeAgent(workspacePath: string): Promise<AgentProcess> {
    return this.startAgentByType('claude', workspacePath);
  }

  stopAgent(): void {
    if (this._childProcess) {
      log('info', 'Stopping agent', { command: this._command });
      this._childProcess.kill('SIGTERM');
      setTimeout(() => {
        if (this._childProcess && !this._childProcess.killed) {
          this._childProcess.kill('SIGKILL');
        }
      }, 3000);
      this._childProcess = null;
    }
  }

  isRunning(): boolean {
    return this._childProcess !== null && !this._childProcess.killed && this._childProcess.exitCode === null;
  }
}
