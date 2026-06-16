import type * as acp from '@agentclientprotocol/sdk';
import { AgentManager, type AcpAgentType } from './AgentManager.js';
import { OpenCodeWikiACPClient } from './callbacks.js';
import type { AcpMessageHandler } from './types.js';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function log(level: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [acp] [' + level + '] ' + line);
}

/** Config file fields relevant to ACP. */
export interface AcpConfig {
  /** Agent type or binary path: 'kilo', 'claude', or a custom path. */
  acpAgent?: string;
  /** Whether ACP is enabled (default: env OPENCODEWIKI_ACP_ENABLE or false). */
  acpEnabled?: boolean;
  /** Whether to use cross-repo ACP root (default: env OPENCODEWIKI_ACP_CROSS_ROOT or false). */
  acpCrossRoot?: boolean;
  /** Working directory override. */
  acpCwd?: string;
}

/**
 * Load ACP config from ~/.opencodewiki/config.json.
 * Returns empty object if file doesn't exist or is invalid.
 */
function loadConfigFile(): AcpConfig {
  const configFile = path.join(os.homedir(), '.opencodewiki', 'config.json');
  try {
    const raw = fs.readFileSync(configFile, 'utf-8');
    return JSON.parse(raw) as AcpConfig;
  } catch {
    return {};
  }
}

/**
 * Resolve ACP agent configuration.
 * Priority (highest first):
 *   1. Explicit `acpAgent` parameter
 *   2. OPENCODEWIKI_ACP_AGENT env var
 *   3. ~/.opencodewiki/config.json `acpAgent` field
 *   4. Default: 'kilo'
 *
 * Returns { agentName, agentArgs, env } where agentName is the binary/command.
 */
export function resolveAgentConfig(acpAgent?: string): { agentName: string; agentArgs: string[]; env: Record<string, string> } {
  const fileCfg = loadConfigFile();
  const raw = acpAgent
    || process.env.OPENCODEWIKI_ACP_AGENT
    || fileCfg.acpAgent
    || 'kilo';

  const cwd = process.env.OPENCODEWIKI_ACP_CWD || fileCfg.acpCwd || process.cwd();

  if (raw === 'kilo') {
    return {
      agentName: 'kilo',
      agentArgs: ['acp', '--port', '0', '--cwd', cwd],
      env: {},
    };
  }
  if (raw === 'claude') {
    return {
      agentName: 'claude-agent-acp',
      agentArgs: ['acp', '--port', '0', '--cwd', cwd],
      env: {},
    };
  }

  // Custom binary path, optionally with colon-separated extra args
  const parts = raw.split(':');
  const agentName = parts[0];
  const agentArgs = parts.slice(1);
  // Inject --cwd if not already provided
  if (!agentArgs.includes('--cwd')) {
    agentArgs.push('--cwd', cwd);
  }
  return { agentName, agentArgs, env: {} };
}

/**
 * Check whether ACP is enabled.
 * Priority: explicit flag > env var > config file > default false.
 */
export function isAcpEnabled(acpEnabled?: boolean): boolean {
  if (acpEnabled !== undefined) return acpEnabled;
  if (process.env.OPENCODEWIKI_ACP_ENABLE) {
    return process.env.OPENCODEWIKI_ACP_ENABLE === 'true';
  }
  const fileCfg = loadConfigFile();
  // Default true — ACP Agent mode enhances QA with autonomous code analysis
  return fileCfg.acpEnabled !== false;
}

/**
 * Check whether ACP cross-repo mode is enabled.
 * Priority: explicit flag > env var > config file > default false.
 */
export function isAcpCrossRoot(acpCrossRoot?: boolean): boolean {
  if (acpCrossRoot !== undefined) return acpCrossRoot;
  if (process.env.OPENCODEWIKI_ACP_CROSS_ROOT) {
    return process.env.OPENCODEWIKI_ACP_CROSS_ROOT === 'true';
  }
  const fileCfg = loadConfigFile();
  return fileCfg.acpCrossRoot === true;
}

export class AcpClient {
  private connection: acp.ClientSideConnection | null = null;
  private agentManager: AgentManager;
  private client: OpenCodeWikiACPClient | null = null;
  private _connected = false;
  private _lastError = '';
  private _cwd = '';

  /** The spawned ACP subprocess, if any. Exposed so callers can monitor exit. */
  private _agentProcess: ChildProcess | null = null;

  get connected(): boolean {
    return this._connected;
  }

  get lastError(): string {
    return this._lastError;
  }

  get exitCode(): number | null {
    return this._agentProcess?.exitCode ?? null;
  }

  constructor(cwd: string) {
    this._cwd = cwd;
    this.agentManager = new AgentManager();
  }

  /**
   * Connect to an ACP agent by spawning its subprocess.
   *
   * @param agentName - Binary name/path (default: from env or 'kilo')
   * @param args - CLI arguments (default: ACP flags for the agent type)
   * @param envOverride - Optional env overrides
   */
  async connect(
    agentName?: string,
    args?: string[],
    envOverride?: Record<string, string>,
  ): Promise<boolean> {
    try {
      const sdk = await this.loadSDK();

      // Resolve agent config: explicit params > env var > 'kilo' default
      let resolvedName = agentName;
      let resolvedArgs = args;
      let resolvedEnv: Record<string, string> = {};

      if (!resolvedName) {
        const cfg = resolveAgentConfig();
        resolvedName = cfg.agentName;
        resolvedArgs = cfg.agentArgs;
        resolvedEnv = cfg.env;
      } else {
        // If called with explicit name but no args, build default ACP args
        if (!resolvedArgs || resolvedArgs.length === 0) {
          resolvedArgs = ['acp', '--port', '0', '--cwd', this._cwd];
        }
      }

      log('info', 'Connecting ACP agent', { name: resolvedName, args: resolvedArgs?.join(' ') });
      const { process, input, output } = await this.agentManager.startAgent(
        resolvedName,
        resolvedArgs ?? [],
        { ...resolvedEnv, ...envOverride },
      );
      this._agentProcess = process;

      const stream = sdk.ndJsonStream(input, output);

      this.client = new OpenCodeWikiACPClient();
      this.client.setCwd(this._cwd);
      this.connection = new sdk.ClientSideConnection(
        () => this.client!,
        stream,
      );

      const initResult = await this.connection.initialize({
        protocolVersion: sdk.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: {
          name: 'opencodewiki',
          title: 'opencodewiki',
          version: '1.0.0',
        },
      });

      this._connected = true;
      log('info', 'ACP connected', { protocolVersion: initResult.protocolVersion });
      return true;
    } catch (err) {
      this._lastError = (err as Error)?.message || String(err);
      log('error', 'ACP connection failed', { error: this._lastError });
      return false;
    }
  }

  /**
   * Connect using a known ACP agent type.
   * Equivalent to connect() with the built-in agent config.
   */
  async connectByType(agentType: AcpAgentType): Promise<boolean> {
    const { process, input, output } = await this.agentManager.startAgentByType(agentType, this._cwd);
    this._agentProcess = process;

    try {
      const sdk = await this.loadSDK();
      const stream = sdk.ndJsonStream(input, output);

      this.client = new OpenCodeWikiACPClient();
      this.client.setCwd(this._cwd);
      this.connection = new sdk.ClientSideConnection(
        () => this.client!,
        stream,
      );

      const initResult = await this.connection.initialize({
        protocolVersion: sdk.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: {
          name: 'opencodewiki',
          title: 'opencodewiki',
          version: '1.0.0',
        },
      });

      this._connected = true;
      log('info', 'ACP connected via type', { agentType, protocolVersion: initResult.protocolVersion });
      return true;
    } catch (err) {
      this._lastError = (err as Error)?.message || String(err);
      log('error', 'ACP connection failed', { agentType, error: this._lastError });
      return false;
    }
  }

  async createSession(): Promise<string | null> {
    if (!this.connection) {
      this._lastError = 'ACP not connected';
      return null;
    }

    try {
      const result = await this.connection.newSession({
        cwd: this._cwd,
        mcpServers: [
          {
            name: 'codegraph',
            command: 'npx',
            args: ['codegraph', 'serve', '--mcp', '--no-watch', '--path', this._cwd],
            env: [],
          },
        ],
      });
      return result.sessionId;
    } catch (err) {
      this._lastError = `createSession failed: ${(err as Error)?.message || String(err)}`;
      log('error', this._lastError);
      return null;
    }
  }

  async sendPrompt(sessionId: string, text: string, handler: AcpMessageHandler): Promise<void> {
    if (!this.connection) {
      handler.onError(this._lastError || 'ACP not connected');
      return;
    }

    try {
      this.client?.setSessionHandler(sessionId, handler);

      await this.connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      });

      await this.awaitIdle(300, 60000);
      this.client?.clearSessionHandler(sessionId);

      handler.onDone('end_turn');
    } catch (err: any) {
      handler.onError(err?.message || 'ACP prompt failed');
    }
  }

  async cancel(sessionId: string): Promise<void> {
    if (!this.connection) return;
    try {
      await this.connection.cancel({ sessionId });
    } catch {}
  }

  async closeSession(sessionId: string): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.closeSession({ sessionId });
      } catch {}
    }
  }

  async dispose(): Promise<void> {
    // Close all sessions first
    // (Sessions are tracked externally via qa-endpoint; we just clean up the connection)
    this.client = null;
    this.connection = null;
    this.agentManager.stopAgent();
    this._agentProcess = null;
    this._connected = false;
    log('info', 'ACP client disposed');
  }

  private async awaitIdle(idleMs: number, maxMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const lastActivity = this.client?.lastActivityTime ?? 0;
      if (lastActivity > 0) {
        const inactive = Date.now() - lastActivity;
        if (inactive >= idleMs) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async loadSDK(): Promise<typeof acp> {
    return (await import('@agentclientprotocol/sdk')) as typeof acp;
  }
}
