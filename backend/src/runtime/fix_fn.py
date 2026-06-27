with open("agent-providers.ts", "r", encoding="utf-8") as f:
    content = f.read()

# Find the broken function block and replace it entirely
broken_start = content.find("// Ensure llama-server")
broken_end = content.find("}", content.find("export function ensureUserMessage")) + 1

if broken_start != -1 and broken_end != -1:
    # Extract to find the next character which is likely a newline
    block = content[broken_start:broken_end]
    # We want to replace this block
    correct_fn = '''// Ensure llama-server (Qwen3.6) doesn't reject requests missing a user role
export function ensureUserMessage(messages: any[]): any[] {
  console.log("[ensureUserMessage] history length:", messages.length, "has user:", messages.some((m: any) => m.role === "user"));
  if (messages.length > 0 && !messages.some((m: any) => m.role === "user")) {
    console.log("[ensureUserMessage] Appending dummy user message");
    return [...messages, { role: "user", content: "." }];
  }
  return messages;
}'''
    
    # We need to be careful about the replacement range.
    # The broken block might have trailing newlines or whitespace we should keep or trim.
    # Let's find the start and end more robustly.
    
    # Start marker: "// Ensure llama-server"
    # End marker: The closing brace of ensureUserMessage
    # Let's check if the function ends there.
    # After the closing brace, there should be a newline and then export function getFreellmapiConfig
    
    next_fn = content.find("export function getFreellmapiConfig", broken_end)
    if next_fn != -1:
        # Replace from broken_start to next_fn (exclusive of next_fn)
        before = content[:broken_start]
        after = content[next_fn:]
        new_content = before + correct_fn + "\n\n" + after
        with open("agent-providers.ts", "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Fixed function definition")
    else:
        print("Could not find end of block")
else:
    print("Could not locate broken function")
