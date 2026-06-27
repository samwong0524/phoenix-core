file_path = r'F:\swarm-ide\backend\src\runtime\agent-helpers.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

rest_of_func = '''

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
}
'''

if 'reasoning_content' in content:
    print('Function seems complete')
else:
    print('Appending missing part...')
    content = content.rstrip()
    content += rest_of_func
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Done')
