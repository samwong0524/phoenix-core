import os

filepath = os.path.join(os.getcwd(), "page.tsx")

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Fix 1: Rename midStackHeight from useImState destructure
content = content.replace(
    "midSplitRatio, setMidSplitRatio, midStackHeight, nodeOffsets, setNodeOffsets,",
    "midSplitRatio, setMidSplitRatio, _midStackHeight, nodeOffsets, setNodeOffsets,"
)

# Fix 2: Add :any to all implicit callback params
pairs = [
    ("const onMove = (e)", "const onMove = (e: any)"),
    ("const onTouchMove = (e)", "const onTouchMove = (e: any)"),
    ("const handleMidResizeStart = useCallback((event)", "const handleMidResizeStart = useCallback((event: any)"),
    ("const handleMidMouseDown = useCallback((event)", "const handleMidMouseDown = useCallback((event: any)"),
    ("const handleMidTouchStart = useCallback((event)", "const handleMidTouchStart = useCallback((event: any)"),
    ("const handleRightPanelResizeStart = useCallback((index, event)", "const handleRightPanelResizeStart = useCallback((index: any, event: any)"),
    ("const startNodeDrag = useCallback((id, clientX, clientY)", "const startNodeDrag = useCallback((id: any, clientX: any, clientY: any)"),
    ("const handleNodePointerDown = useCallback((id, event)", "const handleNodePointerDown = useCallback((id: any, event: any)"),
    ("const handleNodeMouseDown = useCallback((id, event)", "const handleNodeMouseDown = useCallback((id: any, event: any)"),
    ("const handleNodeTouchStart = useCallback((id, event)", "const handleNodeTouchStart = useCallback((id: any, event: any)"),
]
for old, new in pairs:
    content = content.replace(old, new)

# Fix 3: Update topoNodes to match TopoNode type
old_topo = """  const topoNodes = useMemo(() => {
    return (agents ?? []).map((a: any) => ({
      id: a.id,
      label: a.role ?? a.name ?? "unknown",
      x: 0, y: 0,
    }));
  }, [agents]);"""

new_topo = """  const topoNodes = useMemo(() => {
    return (agents ?? []).map((a: any, i: number) => ({
      id: a.id,
      x: 0, y: 0,
      color: "#888",
      r: 6,
      status: a.role ?? "unknown",
    }));
  }, [agents]);"""

content = content.replace(old_topo, new_topo)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("page.tsx: all fixes applied")
