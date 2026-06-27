import re
file_path = r'F:\swarm-ide\backend\src\runtime\agent-helpers.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()
new_func = """export function mapOpenRouterMessages(history: HistoryMessage[]): Array<Record<string, unknown>> {
  // Qwen/llama.cpp templates require 'system' messages to appear only at the start.
  const systems: HistoryMessage[] = [];
  const others: HistoryMessage[] = [];
  for (const msg of history) {
    if (msg.role === 'system') systems.push(msg);
    else others.push(msg);
  }
  const normalized = [...systems, ...others];

  return normalized.map((msg) => {
    if (msg.role === 'tool') return msg;

    const { reasoning_content, ...rest } = msg as Exclude<HistoryMessage, { role: 'tool' }>;
    const mapped: Record<string, unknown> = { ...rest };

    if (mapped.content === null || mapped.content === undefined) {
      mapped.content = '';
    }

    if (msg.role === 'assistant' && reasoning_content) {
      mapped.reasoning = reasoning_content;
    }

    if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      mapped.tool_calls = (msg.tool_calls as Array<Record<string, unknown>>).map((tc) => {
        if (tc.function && typeof tc.function === 'object') {
          const fn = tc.function as Record<string, unknown>;
          const args = fn.arguments;
          if (typeof args === 'string') {
            try { JSON.parse(args); } catch { fn.arguments = '{}'; }
          } else if (typeof args === 'object' && args !== null) {
            fn.arguments = JSON.stringify(args);
          } else {
            fn.arguments = '{}';
          }
        }
        return tc;
      });
    }
    return mapped;
  });
}"""
pattern = r'export function mapOpenRouterMessages\(history: HistoryMessage\[\]\): Array<Record<string, unknown>> \{[\s\S]*?^\}'
match = re.search(pattern, content, re.MULTILINE)
if match:
    print(f'Found function at {match.start()}-{match.end()}')
    new_content = content[:match.start()] + new_func + content[match.end():]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('Replaced successfully')
else:
    print('Function not found!')
