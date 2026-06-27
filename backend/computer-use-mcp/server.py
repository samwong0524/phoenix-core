#!/usr/bin/env python3
"""Windows Computer Use MCP Server.

Provides desktop automation tools for SWARM-IDE agents:
- screenshot: capture the screen (saves to temp file, returns path)
- click / double_click / right_click: mouse actions
- type_text: type text at current cursor position
- key_combo: send keyboard shortcuts
- scroll: scroll mouse wheel
- list_windows: enumerate visible windows
- wait: pause for N seconds
- move_mouse: move cursor to coordinates

Requires: pyautogui, pywinauto, mcp
Install: uv add pyautogui pywinauto mcp
"""

import os
import tempfile
import time
from pathlib import Path

try:
    import pyautogui
except ImportError:
    pyautogui = None

try:
    from pywinauto import Desktop
    from pywinauto.application import Application
except ImportError:
    Desktop = None  # type: ignore

from mcp.server.fastmcp import FastMCP

# Safety: fail fast if GUI libs are missing
if pyautogui is None:
    raise RuntimeError("pyautogui not installed. Run: uv add pyautogui")
if Desktop is None:
    raise RuntimeError("pywinauto not installed. Run: uv add pywinauto")

# Screenshot storage
SCREENSHOT_DIR = Path(os.environ.get("COMPUTER_USE_SCREENSHOT_DIR", tempfile.gettempdir())) / "computer-use-screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

mcp = FastMCP("computer-use")


# ---------------------------------------------------------------------------
# Screenshot
# ---------------------------------------------------------------------------

@mcp.tool()
def screenshot(
    region: str | None = None,
    save_path: str | None = None,
) -> dict:
    """Take a screenshot of the desktop.

    Args:
        region: Optional bounding box "x,y,width,height" (e.g. "0,0,1920,1080").
                If omitted, captures the full screen.
        save_path: Optional absolute path to save the PNG. If omitted, a
                   timestamped file is created in the screenshots directory.

    Returns:
        dict with path, size, and timestamp.
    """
    if region:
        parts = [int(p.strip()) for p in region.split(",")]
        if len(parts) != 4:
            return {"error": "region must be 'x,y,width,height'", "ok": False}
        bbox = tuple(parts)
    else:
        bbox = None

    img = pyautogui.screenshot(region=bbox)

    if save_path:
        path = Path(save_path)
    else:
        ts = int(time.time())
        path = SCREENSHOT_DIR / f"screenshot_{ts}.png"

    img.save(str(path), "PNG")
    size = path.stat().st_size

    return {
        "ok": True,
        "path": str(path),
        "size_bytes": size,
        "width": img.width,
        "height": img.height,
        "timestamp": ts,
    }


# ---------------------------------------------------------------------------
# Mouse actions
# ---------------------------------------------------------------------------

@mcp.tool()
def click(x: int, y: int, button: str = "left") -> dict:
    """Click at screen coordinates (x, y).

    Args:
        x: Screen X coordinate (pixels from left).
        y: Screen Y coordinate (pixels from top).
        button: "left" (default), "right", or "middle".
    """
    pyautogui.click(x=x, y=y, button=button)
    return {"ok": True, "action": "click", "x": x, "y": y, "button": button}


@mcp.tool()
def double_click(x: int, y: int) -> dict:
    """Double-click at screen coordinates (x, y)."""
    pyautogui.doubleClick(x=x, y=y)
    return {"ok": True, "action": "double_click", "x": x, "y": y}


@mcp.tool()
def right_click(x: int, y: int) -> dict:
    """Right-click at screen coordinates (x, y)."""
    pyautogui.rightClick(x=x, y=y)
    return {"ok": True, "action": "right_click", "x": x, "y": y}


@mcp.tool()
def move_mouse(x: int, y: int, duration: float = 0.0) -> dict:
    """Move the mouse cursor to screen coordinates (x, y).

    Args:
        x: Screen X coordinate.
        y: Screen Y coordinate.
        duration: Animation duration in seconds (0 = instant).
    """
    pyautogui.moveTo(x=x, y=y, duration=duration)
    return {"ok": True, "action": "move_mouse", "x": x, "y": y}


# ---------------------------------------------------------------------------
# Keyboard
# ---------------------------------------------------------------------------

@mcp.tool()
def type_text(text: str, interval: float = 0.01) -> dict:
    """Type text at the current cursor position.

    Args:
        text: The text string to type.
        interval: Seconds between keystrokes (default 0.01).
    """
    pyautogui.typewrite(text, interval=interval)
    return {"ok": True, "action": "type_text", "chars": len(text)}


@mcp.tool()
def key_combo(keys: str) -> dict:
    """Send a keyboard shortcut.

    Examples:
        "ctrl+c", "ctrl+v", "alt+tab", "win", "enter", "escape",
        "ctrl+shift+esc", "f5"

    Args:
        keys: Key combination using '+' separator (e.g. "ctrl+s").
    """
    # Safety: block destructive key combos
    blocked = {"win+d", "win+l", "ctrl+alt+delete", "alt+f4"}
    combo = keys.lower().strip()
    if combo in blocked:
        return {
            "error": f"blocked key combo: {combo}",
            "hint": "Destructive system shortcuts are hard-blocked.",
            "ok": False,
        }

    key_list = [k.strip() for k in keys.split("+")]
    pyautogui.hotkey(*key_list)
    return {"ok": True, "action": "key_combo", "keys": keys}


# ---------------------------------------------------------------------------
# Scroll
# ---------------------------------------------------------------------------

@mcp.tool()
def scroll(amount: int = 3, x: int | None = None, y: int | None = None) -> dict:
    """Scroll the mouse wheel.

    Args:
        amount: Scroll ticks. Positive = up, negative = down.
        x: Optional X coordinate to scroll at. If omitted, uses current cursor.
        y: Optional Y coordinate to scroll at.
    """
    if x is not None and y is not None:
        pyautogui.scroll(amount, x=x, y=y)
    else:
        pyautogui.scroll(amount)
    return {"ok": True, "action": "scroll", "amount": amount, "x": x, "y": y}


# ---------------------------------------------------------------------------
# Window enumeration
# ---------------------------------------------------------------------------

@mcp.tool()
def list_windows() -> dict:
    """List all visible top-level windows with titles and bounding boxes.

    Returns a list of windows with title, pid, and rect (left, top, right, bottom).
    """
    try:
        desktop = Desktop(backend="uia")
        windows = desktop.windows()
        result = []
        for w in windows:
            try:
                rect = w.rectangle()
                if rect is None:
                    continue
                # Skip invisible/minimized windows
                if rect.width() <= 0 or rect.height() <= 0:
                    continue
                try:
                    title = w.window_text() or ""
                except Exception:
                    title = ""
                if not title:
                    continue
                result.append({
                    "title": title,
                    "pid": w.element_info.process_id,
                    "rect": {
                        "left": rect.left,
                        "top": rect.top,
                        "right": rect.right,
                        "bottom": rect.bottom,
                        "width": rect.width(),
                        "height": rect.height(),
                    },
                })
            except Exception:
                continue
        return {"ok": True, "windows": result, "count": len(result)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

@mcp.tool()
def wait(seconds: float = 1.0) -> dict:
    """Pause for the specified number of seconds (max 30).

    Useful for waiting for UI transitions to complete.
    """
    secs = min(float(seconds), 30.0)
    time.sleep(secs)
    return {"ok": True, "action": "wait", "seconds": secs}


@mcp.tool()
def get_mouse_position() -> dict:
    """Return the current mouse cursor position."""
    x, y = pyautogui.position()
    return {"ok": True, "x": x, "y": y}


@mcp.tool()
def get_screen_size() -> dict:
    """Return the primary screen dimensions."""
    width, height = pyautogui.size()
    return {"ok": True, "width": width, "height": height}


if __name__ == "__main__":
    mcp.run(transport="stdio")
