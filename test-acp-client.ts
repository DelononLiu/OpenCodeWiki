/**
 * 最小化 ACP 连接测试脚本。
 * 测试通过 ACP 连接 Claude Code Agent 并发送 prompt。
 *
 * 用法：
 *   OPENCODEWIKI_ACP_AGENT=claude npx tsx test-acp-client.ts
 *   OPENCODEWIKI_ACP_AGENT=kilo   npx tsx test-acp-client.ts
 *   npx tsx test-acp-client.ts /path/to/claude-agent-acp
 */
import { AcpClient, resolveAgentConfig } from './src/server/acp/AcpClient.js';
import type { AcpMessageHandler } from './src/server/acp/types.js';

async function main() {
  const customAgent = process.argv[2];
  const cwd = process.cwd();

  const client = new AcpClient(cwd);

  // Connect: use CLI arg if provided, otherwise env/config default
  let ok: boolean;
  if (customAgent) {
    ok = await client.connect(customAgent, ['acp', '--port', '0', '--cwd', cwd]);
  } else {
    const cfg = resolveAgentConfig();
    console.log('Using agent:', cfg.agentName, cfg.agentArgs.join(' '));
    ok = await client.connect();
  }

  if (!ok) {
    console.error('Failed to connect:', client.lastError);
    process.exit(1);
  }
  console.log('✅ ACP connected');

  const sessionId = await client.createSession();
  if (!sessionId) {
    console.error('Failed to create session:', client.lastError);
    process.exit(1);
  }
  console.log('✅ Session created:', sessionId);

  const prompt = 'Say hello in exactly 5 words. Reply ONLY the greeting.';
  console.log(`\nSending: "${prompt}"\n`);

  await client.sendPrompt(sessionId, prompt, {
    onText: (text) => process.stdout.write(text),
    onReasoning: () => {},
    onToolCall: () => {},
    onToolCallUpdate: () => {},
    onPlan: () => {},
    onError: (error) => console.error('\n❌ Error:', error),
    onDone: (reason) => console.log(`\n\n✅ Done (${reason})`),
  });

  await client.closeSession(sessionId);
  await client.dispose();
}

main().catch(console.error);
