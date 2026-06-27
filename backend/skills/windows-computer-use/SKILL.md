---
name: windows-computer-use
description: |
  Control the Windows desktop — take screenshots, click, type, scroll, list windows.
  Use this skill when you need to interact with GUI applications that have no API.
version: 1.0.0
platforms: [windows]
metadata:
  tags: [computer-use, windows, desktop, automation, gui]
  category: desktop
  related_skills: [bash]
---

# Windows Computer Use (Desktop Automation)

You have access to the `mcp.computer-use.*` tools for controlling the Windows desktop.
These tools use `pyautogui` and `pywinauto` for GUI automation.

## The canonical workflow

**Step 1 — Capture first.** Almost every task starts with a screenshot:

```
mcp.computer-use.screenshot()
```

Returns the path to the saved PNG file and screen dimensions.

**Step 2 — Identify target.** Use `list_windows()` to find the target application's
position on screen.

**Step 3 — Interact.** Click, type, or scroll:

```
mcp.computer-use.click(x=500, y=300)
mcp.computer-use.type_text(text="hello world")
mcp.computer-use.key_combo(keys="ctrl+c")
```

**Step 4 — Verify.** Re-capture after any state-changing action to confirm the result.

## Available tools

| Tool | Args | Description |
|------|------|-------------|
| `screenshot` | `region?`, `save_path?` | Capture the screen. Returns PNG file path and dimensions. |
| `click` | `x`, `y`, `button?` | Click at screen coordinates. button: left/right/middle. |
| `double_click` | `x`, `y` | Double-click at coordinates. |
| `right_click` | `x`, `y` | Right-click at coordinates. |
| `move_mouse` | `x`, `y`, `duration?` | Move cursor to coordinates. |
| `type_text` | `text`, `interval?` | Type text at current cursor position. |
| `key_combo` | `keys` | Send keyboard shortcut (e.g. "ctrl+c", "alt+tab"). |
| `scroll` | `amount?`, `x?`, `y?` | Scroll mouse wheel. Positive=up, negative=down. |
| `list_windows` | — | List visible windows with titles and bounding boxes. |
| `wait` | `seconds?` | Pause for N seconds (max 30). |
| `get_mouse_position` | — | Return current cursor coordinates. |
| `get_screen_size` | — | Return primary screen dimensions. |

## Safety — hard rules

- **Never use blocked key combos:** `win+d`, `win+l`, `ctrl+alt+delete`, `alt+f4`
- **Never type passwords, API keys, or secrets**
- **Never interact with permission dialogs, password prompts, or payment UI** without explicit user instruction
- **Always verify after action:** re-capture to confirm the click/typing had the expected effect
- **Don't interact with personal browser tabs** (email, banking, Messages) unless that's the task

## Best practices

1. **Always screenshot first** — never click blindly. Capture the screen, identify the target, then click.
2. **Use list_windows** to find the target application's bounding box before calculating coordinates.
3. **Wait for UI transitions** — after clicking, use `wait(seconds=1)` to let the UI settle before capturing again.
4. **Calculate coordinates from window rect** — `list_windows` returns `{left, top, right, bottom}`. Click at `(left + offset_x, top + offset_y)` for reliable targeting.

## Failure modes

- **"pyautogui not installed"** — Run `pip install pyautogui` in the computer-use-mcp directory.
- **"pywinauto not installed"** — Run `pip install pywinauto` in the computer-use-mcp directory.
- **Screenshot shows wrong window** — Use `list_windows()` to find the correct window's rect, then calculate coordinates.
- **Click had no effect** — The target may have moved. Re-capture and re-calculate coordinates.
- **No desktop session** — pyautogui requires an active desktop session. Will not work in Windows Services or RDP disconnected sessions.

## When NOT to use computer_use

- **File operations** — use `bash` with `cat`, `grep`, `node`, etc.
- **Shell commands** — use `bash`, not typing into cmd/PowerShell windows.
- **Web automation** — use the `chrome-devtools` MCP if available, which is more reliable than driving a GUI browser.
- **API calls** — use `bash` with `curl`, or existing API tools.
