import base64
content_b64 = "aW1wb3J0IHsgSGlzdG9yeU1lc3NhZ2UsIFVVSUQsIFNLSUxMU19NQVJLRVIsIFNPVUxfTUFSS0VSIiBmcm9tICIuL2FnZW50LXR5cGVzIjsKZXhwb3J0IGZ1bmN0aW9uIG1hcE9wZW5Sb3V0ZXJNZXNzYWdlcyhoaXN0b3J5OiBIaXN0b3J5TWVzc2FnZVtdKTogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHsKICAvLyBRd2VuL2xsYW1hLmNwcCB0ZW1wbGF0ZXMgcmVxdWlyZSAnc3lzdGVtJyBtZXNzYWdlcyB0byBhcHBlYXIgb25seSBhdCB0aGUgc3RhcnQuCiAgY29uc3Qgc3lzdGVtczogSGlzdG9yeU1lc3NhZ2VbXSA9IFtdOwogIGNvbnN0IG90aGVyczogSGlzdG9yeU1lc3NhZ2VbXSA9IFtdOwogIGZvciAoY29uc3QgbXNnIG9mIGhpc3RvcnkpIHsKICAgIGlmIChtc2cucm9sZSA9PT0gInN5c3RlbSIpc3lzdGVtcy5wdXNoKG1zZyk7CiAgICBlbHNlIG90aGVycy5wdXNoKG1zZyk7CiAgfQogIGNvbnN0IG5vcm1hbGl6ZWQgPSBbLi4uc3lzdGVtcywgLi4ub3RoZXJzXTsKCiAgcmV0dXJuIG5vcm1hbGl6ZWQubWFwKChtc2cpID0+IHsKICAgIGlmIChtc2cucm9sZSA9PT0gInRvb2wiKSByZXR1cm4gbXNnOwogICAgY29uc3QgeyByZWFzb25pbmdfY29udGVudCwgLi4ucmVzdCB9ID0gbXNnIGFzIEV4Y2x1ZGU8SGlzdG9yeU1lc3NhZ2UsIHsgcm9sZTogInRvb2wiIH0+OwogICAgY29uc3QgbWFwcGVkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgLi4ucmVzdCB9OwogICAgaWYgKG1hcHBlZC5jb250ZW50ID09PSBudWxsIHx8IG1hcHBlZC5jb250ZW50ID09PSB1bmRlZmluZWQpIG1hcHBlZC5jb250ZW50ID0gIiI7CiAgICBpZiAobXNnLnJvbGUgPT09ICJhc3Npc3RhbnQiICYmIHJlYXNvbmluZ19jb250ZW50KSBtYXBwZWQucmVhc29uaW5nID0gcmVhc29uaW5nX2NvbnRlbnQ7CiAgICBpZiAobXNnLnJvbGUgPT09ICJhc3Npc3RhbnQiICYmIG1zZy50b29sX2NhbGxzICYmIEFycmF5LmlzQXJyYXkobXNnLnRvb2xfY2FsbHMpKSB7CiAgICAgIG1hcHBlZC50b29sX2NhbGxzID0gKG1zZy50b29sX2NhbGxzIGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PikubWFwKCh0YykgPT4gewogICAgICAgIGlmICh0Yy5mdW5jdGlvbiAmJiB0eXBlb2YgdGMuZnVuY3Rpb24gPT09ICJvYmplY3QiKSB7CiAgICAgICAgICBjb25zdCBmbiA9IHRjLmZ1bmN0aW9uIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+OwogICAgICAgICAgY29uc3QgYXJncyA9IGZuLmFyZ3VtZW50czsKICAgICAgICAgIGlmICh0eXBlb2YgYXJncyA9PT0gInN0cmluZyIpIHsgdHJ5IHsgSlNPTi5wYXJzZShhcmdzKTsgfSBjYXRjaCB7IGZuLmFyZ3VtZW50cyA9ICJ7fSI7IH0gfQogICAgICAgICAgZWxzZSBpZiAodHlwZW9mIGFyZ3MgPT09ICJvYmplY3QiICYmIGFyZ3MgIT09IG51bGwpIHsgZm4uYXJndW1lbnRzID0gSlNPTi5zdHJpbmdpZnkoYXJncyk7IH0KICAgICAgICAgIGVsc2UgeyBmbi5hcmd1bWVudHMgPSAie30iOyB9CiAgICAgICAgfQogICAgICAgIHJldHVybiB0YzsKICAgICAgfSk7CiAgICB9CiAgICByZXR1cm4gbWFwcGVkOwogIH0pOwp9"
content = base64.b64decode(content_b64).decode('utf-8')

# Read current file to check imports
file_path = r'F:\swarm-ide\backend\src\runtime\agent-helpers.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    current = f.read()

# We need to prepend the imports if they are missing
if not current.startswith('import'):
    # The file is truncated, so we write the full content
    # But first, let's find the imports from the previous output or reconstruct them
    imports = '''import { HistoryMessage, UUID, SKILLS_MARKER, SOUL_MARKER } from "./agent-types";
import { COMPRESS_TRIGGER, COMPRESS_PROTECT_FIRST, COMPRESS_PROTECT_LAST, COMPRESS_MAX_CONTENT } from "./agent-constants";
import { sql } from "drizzle-orm";
import { safeJsonParse } from "./utils";
import { getSkillLoader } from "./skill-loader";
import * as path from "path";
import * as fs from "fs/promises";
'''
    # Actually, the file currently has 32 lines, but they are just the tail of the function!
    # Let's just overwrite it completely with a reconstructed version.
    # Since I can't reconstruct the WHOLE file easily from memory without risk of missing things,
    # let's look for a backup.
    print('File is truncated. Searching for backup...')
