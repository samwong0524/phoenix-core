---
name: infinite-canvas-frontend
description: 无限画布项目前端代码结构和实现指南
---
# 无限画布前端项目结构

## 技术栈
- Vite + React 18 + TypeScript
- Konva.js 渲染引擎
- Zustand 状态管理
- Yjs 协同编辑（预留）

## 项目目录
```
frontend/
├── src/
│   ├── components/
│   │   ├── Canvas/          # 画布核心组件
│   │   ├── Toolbar/         # 工具栏
│   │   └── NodePanel/       # 节点面板
│   ├── hooks/               # 自定义 hooks
│   ├── store/               # Zustand store
│   ├── utils/               # 工具函数
│   ├── types/               # TypeScript 类型
│   └── App.tsx
├── package.json
└── vite.config.ts
```