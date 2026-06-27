import re, os

filepath = os.path.join(os.getcwd(), "page.tsx")

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Fix midStackHeight - rename the one from useImState to _midStackHeight
# line 53: midStackRatio, setMidStackRatio, midStackHeight, nodeOffsets, setNodeOffsets,
content = content.replace("midStackRatio, setMidStackRatio, midStackHeight, nodeOffsets, setNodeOffsets,", "midStackRatio, setMidStackRatio, _midStackHeight, nodeOffsets, setNodeOffsets,")

# 2. Fix implicit any types - add :any to all callback params that trigger errors
fixes = {
    "useCallback((id)": "useCallback((id: any)",
    "useCallback((clientY)": "useCallback((clientY: any)",
    "useCallback((e)": "useCallback((e: any)",
    ".map((id, event)": ".map((id: any, event: any)",
    ".map((agent)": ".map((agent: any)",
    ".map((id, event) =>": ".map((id: any, event: any) =>",
    ".map(async (id, event)": ".map(async (id: any, event: any)",
}

# Apply fixes - but be careful not to over-replace
for old, new in fixes.items():
    if old in content:
        content = content.replace(old, new)

# Fix specific patterns that need more care
# Line 419 (1-indexed): .map((index, event) => (
content = content.replace(
    ".map((index, event) => (",
    ".map((index: any, event: any) => ("
)
# Line 457: .map((id, clientX, clientY) => {
content = content.replace(
    ".map((id, clientX, clientY) => {",
    ".map((id: any, clientX: any, clientY: any) => {"
)
# Line 501: .map((id, event) => {
content = content.replace(
    ".map((id, event) => {",
    ".map((id: any, event: any) => {"
)
# Line 507: .map((id, event) => (
content = content.replace(
    ".map((id, event) => (",
    ".map((id: any, event: any) => ("
)

# 3. Add FileCard and MarkdownContent inline components
# Find a good place to add them - after the Streamdown plugins and before the IMPageInner function
# The code plugin is defined at: const code = createCodePlugin({...})
# Let's add after that line

filecard_code = """

// Simple file card component
function FileCard({ url, name, size }: { url: string; name: string; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 8, fontSize: 13 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {size != null && <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{(size / 1024).toFixed(0)}KB</span>}
    </div>
  );
}

// Simple markdown content renderer
function MarkdownContent({ content }: { content: string }) {
  return <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>;
}

"""

# Insert after the code plugin line
content = content.replace(
    "const code = createCodePlugin({ themes: [\"github-dark\", \"github-dark\"] });",
    "const code = createCodePlugin({ themes: [\"github-dark\", \"github-dark\"] });" + filecard_code
)

# 4. Add topoNodes and vizLayout computed from agents and vizEvents
# After the useImState destructuring, we need to compute these
# Find the local state section (after line 75 where midStackHeight useState is)
# And add computed vars

viz_compute = """

  // Compute topology layout from agents and viz events
  const topoNodes = useMemo(() => {
    return (agents ?? []).map((a: any) => ({
      id: a.id,
      label: a.role ?? a.name ?? "unknown",
      x: 0, y: 0,
    }));
  }, [agents]);

  const vizLayout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const agents_arr = agents ?? [];
    const count = agents_arr.length;
    const cx_viz = (vizSize?.width ?? 600) / 2;
    const cy_viz = (vizSize?.height ?? 400) / 2;
    const radius = Math.min(cx_viz, cy_viz) * 0.6;
    const ordered: any[] = [];

    agents_arr.forEach((a: any, i: number) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      positions.set(a.id, {
        x: cx_viz + radius * Math.cos(angle),
        y: cy_viz + radius * Math.sin(angle),
      });
      ordered.push(a);
    });

    const edges = ordered.map((a: any) => ({
      fromId: a.id,
      toId: a.id,
    }));

    return { positions, edges, ordered };
  }, [agents, vizSize]);

"""

# Insert after line 75 (0-indexed 74): const [midStackHeight, setMidStackHeight] = useState(0);
insert_point = content.find("const [midStackHeight, setMidStackHeight] = useState(0);")
if insert_point >= 0:
    insert_end = insert_point + len("const [midStackHeight, setMidStackHeight] = useState(0);")
    content = content[:insert_end] + viz_compute + content[insert_end:]

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("page.tsx fixed!")
