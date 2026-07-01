/**
 * Skill 中文翻译模块
 * 为远程技能提供中文描述翻译，支持映射表 + 关键词匹配
 */

// 常见技能中文描述映射（100+ 常用技能）
export const SKILL_DESCRIPTIONS: Record<string, string> = {
  // === 编程开发 ===
  "code-review": "代码审查 — 自动检查代码质量、安全漏洞、最佳实践",
  "git-workflow": "Git 工作流 — 分支管理、commit 规范、PR 自动化",
  "debugging": "调试助手 — 错误分析、日志解读、修复建议",
  "typescript": "TypeScript 助手 — 类型推断、泛型、TS 最佳实践",
  "python": "Python 开发 — 数据处理、脚本编写、API 开发",
  "react": "React 开发 — 组件设计、Hooks、状态管理",
  "vue": "Vue 开发 — 组合式 API、Pinia、路由管理",
  "nextjs": "Next.js 开发 — SSR/SSG、路由、中间件、API Routes",
  "tailwind": "Tailwind CSS — 实用优先的 CSS 框架，快速构建 UI",
  "svelte": "Svelte 开发 — 编译时框架、响应式声明、Stores",
  "golang": "Go 开发 — 并发编程、标准库、性能优化",
  "rust": "Rust 开发 — 内存安全、所有权系统、零成本抽象",
  "java-spring": "Java Spring — Spring Boot、REST API、数据访问层",
  "nodejs": "Node.js 开发 — Express/Koa、异步编程、中间件",
  "cpp": "C++ 开发 — STL、模板、多线程、性能优化",
  "swift": "Swift 开发 — SwiftUI、UIKit、iOS/macOS 应用",
  "kotlin": "Kotlin 开发 — Android、协程、KMP 跨平台",
  "flutter": "Flutter 开发 — Dart、Widget、跨平台 UI",
  "testing": "测试助手 — 单元测试、集成测试、TDD/BDD",
  "refactoring": "代码重构 — 设计模式、代码异味识别、重构手法",
  "architecture": "架构设计 — 微服务、DDD、设计模式、架构决策",
  "performance": "性能优化 — 瓶颈分析、内存泄漏、CPU Profiling",

  // === 数据分析 ===
  "sql-generator": "SQL 生成器 — 自然语言转 SQL 查询",
  "data-cleaning": "数据清洗 — 缺失值处理、格式标准化、异常检测",
  "visualization": "数据可视化 — 图表选型、配色建议、交互设计",
  "csv-analysis": "CSV 分析 — 数据导入、统计、可视化",
  "pandas": "Pandas 数据分析 — DataFrame、数据清洗、聚合统计",
  "numpy": "NumPy 数值计算 — 数组运算、线性代数、统计分析",
  "machine-learning": "机器学习 — 模型训练、特征工程、模型评估",
  "deep-learning": "深度学习 — 神经网络、PyTorch/TensorFlow、模型调优",
  "data-pipeline": "数据管道 — ETL 流程、数据调度、流批一体",

  // === 内容创作 ===
  "doc-writer": "文档写作 — 技术文档、API 文档、用户手册",
  "translation": "翻译助手 — 多语言翻译、术语一致性检查",
  "summarizer": "摘要生成 — 长文档/会议记录自动摘要",
  "copywriting": "文案创作 — 广告文案、营销内容、社交媒体",
  "blog-writer": "博客写作 — SEO 优化、标题生成、内容结构",
  "email-writer": "邮件撰写 — 商务邮件、跟进邮件、模板生成",
  "resume-builder": "简历制作 — 简历优化、ATS 适配、求职信",
  "proofreading": "校对润色 — 语法检查、风格统一、表达优化",

  // === 运维部署 ===
  "docker-compose": "Docker 编排 — 容器配置、网络设置、卷管理",
  "monitoring": "监控告警 — 指标分析、日志聚合、告警规则",
  "ci-cd": "CI/CD 流水线 — GitHub Actions、Jenkins、部署自动化",
  "kubernetes": "Kubernetes 运维 — Pod 管理、服务发现、自动扩缩",
  "terraform": "Terraform — 基础设施即代码、多云资源管理",
  "ansible": "Ansible — 自动化运维、批量部署、配置管理",
  "nginx": "Nginx 配置 — 反向代理、负载均衡、SSL 证书",
  "linux-admin": "Linux 管理 — 系统管理、Shell 脚本、服务配置",
  "aws": "AWS 云服务 — EC2/S3/Lambda、架构设计、成本优化",
  "gcp": "GCP 云服务 — Cloud Run、BigQuery、Firebase",
  "azure": "Azure 云服务 — App Service、Functions、AKS",

  // === 安全 ===
  "security-audit": "安全审计 — 代码安全扫描、漏洞检测、合规检查",
  "penetration-testing": "渗透测试 — 漏洞发现、利用分析、修复建议",
  "dependency-check": "依赖检查 — 第三方库漏洞扫描、版本升级建议",
  "secrets-management": "密钥管理 — 环境变量、密钥轮换、泄露检测",

  // === Web 开发 ===
  "web-search": "网页搜索 — 实时联网搜索、信息检索",
  "web-scraping": "网页抓取 — 网页数据提取、爬虫自动化",
  "image-generation": "图片生成 — AI 绘图、图标设计、图片编辑",
  "pdf-reader": "PDF 解析 — PDF 文档读取、表格提取、OCR",
  "api-caller": "API 调用 — HTTP 请求、接口测试、数据获取",
  "frontend-design": "前端设计 — UI 组件、响应式布局、交互动效",
  "ui-ux": "UI/UX 设计 — 用户界面设计、交互设计、可用性分析",
  "seo": "SEO 优化 — 关键词分析、元标签优化、站点地图",
  "accessibility": "无障碍 — WCAG 合规检查、ARIA 属性、键盘导航",
  "responsive": "响应式设计 — 多端适配、媒体查询、弹性布局",

  // === 阿里生态 ===
  "tongyi-qwen-coding": "通义千问代码助手 — 基于 Qwen 的代码生成与审查",
  "dashscope-rag": "DashScope RAG — 文档解析 + 向量检索 + 智能问答",
  "dingtalk-bot": "钉钉机器人 — 群消息推送、工作通知、审批集成",
  "quickbi-smartq": "Quick BI 智能问数 — 自然语言查询 + 可视化图表",
  "aliyun-fc-deploy": "阿里云函数计算部署 — 自动创建/更新 FC 函数",
  "pai-eas-inference": "PAI-EAS 模型推理 — 一键部署 ML 模型为在线服务",
  "maxcompute-sql": "MaxCompute SQL — 自然语言生成 ODPS SQL",
  "oss-file-manager": "OSS 文件管理 — 对象存储文件上传/下载/处理",

  // === 常用社区技能 ===
  "browser-use": "浏览器自动化 — 网页操作、表单填写、截图",
  "computer-use": "计算机使用 — 桌面自动化、GUI 操作、屏幕识别",
  "mcp-builder": "MCP 构建器 — 创建 Model Context Protocol 服务器",
  "skill-creator": "技能创建器 — 创建新的 Agent Skill",
  "memory": "记忆管理 — 长期记忆存储、上下文管理、知识沉淀",
  "planning": "任务规划 — 任务分解、进度追踪、计划管理",
  "research": "调研助手 — 信息收集、文献分析、报告撰写",
  "code-generation": "代码生成 — 从描述生成完整代码、脚手架搭建",
  "api-design": "API 设计 — RESTful 规范、接口文档、Mock 数据",
  "database": "数据库管理 — Schema 设计、查询优化、数据迁移",
  "devops": "DevOps — 自动化部署、容器化、监控告警",
  "product-management": "产品管理 — PRD 撰写、需求分析、优先级排序",
  "design-system": "设计系统 — 组件库规范、Design Token、样式指南",
  "technical-writing": "技术写作 — README、贡献指南、变更日志",
  "codebase-analysis": "代码库分析 — 架构理解、依赖图、代码质量评估",
  "superpowers-brainstorming": "头脑风暴 — 创意发散、方案对比、可行性分析",
  "superpowers-debugging": "系统化调试 — 问题定位、根因分析、修复验证",
  "superpowers-code-review": "代码评审 — 代码质量、性能、安全多维度审查",
  "frontend-aesthetics": "前端美学 — 排版、配色、动效、氛围设计",
  "web-performance": "Web 性能 — Core Web Vitals、加载优化、缓存策略",
  "xlsx": "Excel 处理 — 读写 .xlsx 文件、公式计算、图表生成",
  "docx": "Word 文档 — 创建/编辑 .docx、格式化、模板填充",
  "pptx": "PPT 演示 — 创建/编辑 .pptx、幻灯片设计",
  "pdf": "PDF 处理 — 创建/读取/合并/拆分 PDF 文件",
  "remotion": "视频制作 — 用 React 创建视频、动画、特效",
  "diagram": "图表绘制 — 架构图、流程图、时序图、UML",
};

/**
 * 检查文本是否包含中文字符
 */
export function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

/**
 * 翻译技能描述为中文
 * 1. 优先从映射表获取
 * 2. 如果描述已是中文，直接返回
 * 3. 尝试关键词匹配生成中文摘要
 * 4. 返回原文 + [EN] 标记
 */
export function translateDescription(skillName: string, description: string): { text: string; isEnglish: boolean } {
  // 1. 映射表命中
  const normalized = skillName.toLowerCase().replace(/[_\s]+/g, "-");
  if (SKILL_DESCRIPTIONS[normalized]) {
    return { text: SKILL_DESCRIPTIONS[normalized], isEnglish: false };
  }

  // 2. 已是中文
  if (hasChinese(description)) {
    return { text: description, isEnglish: false };
  }

  // 3. 关键词匹配生成摘要
  const keywords = extractKeywords(normalized, description);
  if (keywords) {
    return { text: keywords, isEnglish: false };
  }

  // 4. 返回原文 + 英文标记
  return { text: description, isEnglish: true };
}

/**
 * 根据技能名称和描述关键词生成中文摘要
 */
function extractKeywords(name: string, description: string): string | null {
  const lower = `${name} ${description}`.toLowerCase();
  const parts: string[] = [];

  // 识别领域
  if (lower.includes("react") || lower.includes("component")) parts.push("React");
  if (lower.includes("vue")) parts.push("Vue");
  if (lower.includes("next") || lower.includes("nextjs")) parts.push("Next.js");
  if (lower.includes("python") || lower.includes("django") || lower.includes("flask")) parts.push("Python");
  if (lower.includes("typescript") || lower.includes("javascript")) parts.push("TypeScript");
  if (lower.includes("docker")) parts.push("Docker");
  if (lower.includes("kubernetes") || lower.includes("k8s")) parts.push("K8s");
  if (lower.includes("aws") || lower.includes("amazon")) parts.push("AWS");
  if (lower.includes("security") || lower.includes("安全")) parts.push("安全");
  if (lower.includes("test") || lower.includes("测试")) parts.push("测试");
  if (lower.includes("api") || lower.includes("rest")) parts.push("API");
  if (lower.includes("database") || lower.includes("sql")) parts.push("数据库");
  if (lower.includes("ai") || lower.includes("llm") || lower.includes("agent")) parts.push("AI");
  if (lower.includes("design") || lower.includes("ui") || lower.includes("ux")) parts.push("设计");
  if (lower.includes("deploy") || lower.includes("部署")) parts.push("部署");
  if (lower.includes("monitor") || lower.includes("log")) parts.push("监控");

  if (parts.length === 0) return null;

  // 识别动作
  let action = "辅助工具";
  if (lower.includes("generat") || lower.includes("creat") || lower.includes("build")) action = "生成工具";
  if (lower.includes("review") || lower.includes("audit") || lower.includes("check")) action = "审查工具";
  if (lower.includes("optim") || lower.includes("performance") || lower.includes("speed")) action = "优化工具";
  if (lower.includes("automat") || lower.includes("workflow")) action = "自动化工具";
  if (lower.includes("analy") || lower.includes("data")) action = "分析工具";
  if (lower.includes("deploy") || lower.includes("ci") || lower.includes("cd")) action = "部署工具";
  if (lower.includes("write") || lower.includes("doc")) action = "写作工具";
  if (lower.includes("scrap") || lower.includes("crawl") || lower.includes("fetch")) action = "数据抓取";

  return `${parts.join("/")} ${action} — ${description.substring(0, 80)}`;
}
