# Phoenix-Core: Self-Organizing Agent Swarm

<p align="center">
  <a href="https://star-history.com/#samwong0524/phoenix-core&Date">
    <img src="https://api.star-history.com/svg?repos=samwong0524/phoenix-core&type=Date" alt="Star History Chart" width="520" />
  </a>
</p>

[![Demo](assets/image.jpg)](https://www.bilibili.com/video/BV1X163BQE5c/?share_source=copy_web&vd_source=e0705640ea2f51669a392fb07684e286)

## üé¨ Video (Open‚Äësource Kimi‚ÄëK2.5 Multi‚ÄëAgent Swarm)
- Demo (inline playback):
<video src="https://github.com/user-attachments/assets/4ebd88c6-bbdb-4714-87a5-54d1fed08db8" width="100%" controls></video>
- Bilibili full demo: https://www.bilibili.com/video/BV1X163BQE5c/?share_source=copy_web&vd_source=e0705640ea2f51669a392fb07684e286

## WeChat Group
<img src="./assets/qrcode.png" alt="WeChat QR" width="240" />

## Advantages
- Create sub‚Äëagents dynamically
- Message any agent directly
- WeChat‚Äëstyle chat UI: intervene at any depth anytime
- Streaming graph that visualizes collaboration in real time

## Comparison
~~It is worth noting that this project **independently** introduced swarm mode **before** both Kimi-Swarm and Claude Team. Claude Team in particular shows striking overlap: with careful comparison, its core ideas (dynamic delegation and human-to-any-agent communication) **align closely** with this project‚Äôs design. To some extent, this reflects the advanced perspective behind the design. Building this independently at a time when static LangGraph workflows were dominant was notably ahead of its time. The whitepaper was timestamped on-chain back then; if you want to verify this directly, see the [on-chain timestamp](https://viewblock.io/arweave/tx/BJ5GVAQBUXtv21jIEvuyqTsv9t93j7rlG47Lwcmtdu8).~~

| Item | Kimi-Swarm | Claude Agent Team | Phoenix-Core |
| --- | --- | --- | --- |
| Nested agents | ‚ù?| ‚ù?| ‚ú?|
| Inter-agent messaging | ‚ù?| ‚ú?| ‚ú?|
| Human to sub-agent messaging | ‚ù?| ‚ú?| ‚ú?|
| Group chat mode | ‚ù?| ‚ù?| ‚ú?|
| Visualization | ‚ù?| ‚ù?| ‚ú?|
| Open source | ‚ù?| ‚ù?| ‚ú?|
| Release date | 2026.1.27 | 2026.2.6 | 2026.1.2 |

## UI Design
- Graph shows swarm topology and live communication links
- Tree‚Äëstructured multi‚Äëlevel dialogs: talk to any agent like a chat app (even deep ones)
- LLM history panel: shows the agent‚Äôs context; no more black box
- Streaming tool‚Äëcall parameters in real time

## Philosophy
- Minimal primitives: only a few communication primitives are required (core is create + send)
- Liquid topology: topology evolves during runtime; agents ‚Äúhire‚Ä?sub‚Äëagents on demand
- Flat collaboration: humans can step into any layer at any time

## Concept
No complex nodes/edges abstraction ‚Ä?just think of ‚Äúmany people‚Ä?

Everyone can spawn children and talk to anyone.

With only these two capabilities, any structure can be built.

## How to Run
```
cd phoenix-core
cd backend

cp .env.example .env.local
# Fill your keys and model names in .env.local

docker compose up -d
curl -X POST http://127.0.0.1:3100/api/admin/init-db
bun install
bun dev
```

Open http://localhost:3100

Click init-db, then create a workspace to start.

Try: ‚ÄúCreate 3 children, ask them to message each other, then have each create 3 grandchildren.‚Ä?

## Zhihu
https://zhuanlan.zhihu.com/p/2000736341479138182

## Environment Variables
The backend reads `backend/.env.local`:
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` (I use **OpenRouter Kimi 2.5**)
- See `backend/.env.example` for all fields
