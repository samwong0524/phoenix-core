import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getSkillDirectory } from "@/runtime/skill-loader";

// 技能中文描述映射（为常见技能提供中文说明）
const SKILL_DESCRIPTIONS: Record<string, string> = {
  // 编程开发
  "code-review": "代码审查 — 自动检查代码质量、安全漏洞、最佳实践",
  "git-workflow": "Git 工作流 — 分支管理、commit 规范、PR 自动化",
  "debugging": "调试助手 — 错误分析、日志解读、修复建议",
  "typescript": "TypeScript 助手 — 类型推断、泛型、TS 最佳实践",
  "python": "Python 开发 — 数据处理、脚本编写、API 开发",
  "react": "React 开发 — 组件设计、Hooks、状态管理",
  // 数据分析
  "sql-generator": "SQL 生成器 — 自然语言转 SQL 查询",
  "data-cleaning": "数据清洗 — 缺失值处理、格式标准化、异常检测",
  "visualization": "数据可视化 — 图表选型、配色建议、交互设计",
  "csv-analysis": "CSV 分析 — 数据导入、统计、可视化",
  // 内容创作
  "doc-writer": "文档写作 — 技术文档、API 文档、用户手册",
  "translation": "翻译助手 — 多语言翻译、术语一致性检查",
  "summarizer": "摘要生成 — 长文档/会议记录自动摘要",
  "copywriting": "文案创作 — 广告文案、营销内容、社交媒体",
  // 运维部署
  "docker-compose": "Docker 编排 — 容器配置、网络设置、卷管理",
  "monitoring": "监控告警 — 指标分析、日志聚合、告警规则",
  "ci-cd": "CI/CD 流水线 — GitHub Actions、Jenkins、部署自动化",
  "kubernetes": "Kubernetes 运维 — Pod 管理、服务发现、自动扩缩",
  // 阿里生态
  "tongyi-qwen-coding": "通义千问代码助手 — 基于 Qwen 的代码生成与审查",
  "dashscope-rag": "DashScope RAG — 文档解析 + 向量检索 + 智能问答",
  "dingtalk-bot": "钉钉机器人 — 群消息推送、工作通知、审批集成",
  "quickbi-smartq": "Quick BI 智能问数 — 自然语言查询 + 可视化图表",
  "aliyun-fc-deploy": "阿里云函数计算部署 — 自动创建/更新 FC 函数",
  "pai-eas-inference": "PAI-EAS 模型推理 — 一键部署 ML 模型为在线服务",
  "maxcompute-sql": "MaxCompute SQL — 自然语言生成 ODPS SQL",
  "oss-file-manager": "OSS 文件管理 — 对象存储文件上传/下载/处理",
  // 通用工具
  "web-search": "网页搜索 — 实时联网搜索、信息检索",
  "web-scraping": "网页抓取 — 网页数据提取、爬虫自动化",
  "image-generation": "图片生成 — AI 绘图、图标设计、图片编辑",
  "pdf-reader": "PDF 解析 — PDF 文档读取、表格提取、OCR",
  "api-caller": "API 调用 — HTTP 请求、接口测试、数据获取",
};

// 从 SKILL.md 读取描述
function getSkillDescription(skillName: string): string {
  // 优先从映射表获取
  if (SKILL_DESCRIPTIONS[skillName]) {
    return SKILL_DESCRIPTIONS[skillName];
  }
  // 尝试从本地 SKILL.md 读取
  try {
    const skillPath = join(getSkillDirectory(), skillName, "SKILL.md");
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, "utf-8");
      // 解析 YAML frontmatter 中的 description
      const match = content.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
      if (match) {
        const yaml = match[1];
        const descMatch = yaml.match(/description:\s*(.+)/);
        if (descMatch) {
          return descMatch[1].trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  } catch {
    // ignore
  }
  return skillName; // fallback 到技能名
}

export async function GET(): Promise<NextResponse> {
  const db = getDb();

  try {
    // 1. 基于使用统计的热门 skills（本地）
    const popularRows = await db.execute(
      sql`SELECT
        skill_name,
        COUNT(*) as total_calls,
        ROUND(100.0 * COUNT(*) FILTER (WHERE success = true) / NULLIF(COUNT(*), 0), 2) as success_rate,
        COUNT(DISTINCT agent_id) as agent_count,
        MAX(used_at) as last_used
      FROM skill_usage
      WHERE status = 'active'
      GROUP BY skill_name
      HAVING COUNT(*) >= 2
      ORDER BY total_calls DESC
      LIMIT 10`
    );

    const popularLocal = (popularRows as Array<Record<string, unknown>>).map((r) => ({
      name: r.skill_name as string,
      description: getSkillDescription(r.skill_name as string),
      totalCalls: Number(r.total_calls ?? 0),
      successRate: Number(r.success_rate ?? 0),
      agentCount: Number(r.agent_count ?? 0),
      lastUsed: r.last_used as string,
    }));

    // 2. 最近 7 天上升趋势（trending）
    const trendingRows = await db.execute(
      sql`SELECT
        skill_name,
        COUNT(*) as calls_7d,
        COUNT(DISTINCT agent_id) as agent_count
      FROM skill_usage
      WHERE status = 'active' AND used_at > NOW() - INTERVAL '7 days'
      GROUP BY skill_name
      ORDER BY calls_7d DESC
      LIMIT 8`
    );

    const trending = (trendingRows as Array<Record<string, unknown>>).map((r) => ({
      name: r.skill_name as string,
      description: getSkillDescription(r.skill_name as string),
      callsLast7Days: Number(r.calls_7d ?? 0),
      agentCount: Number(r.agent_count ?? 0),
    }));

    // 3. 推荐分类（按使用场景）
    const categories = [
      {
        id: "coding",
        name: "编程开发",
        nameEn: "Coding & Development",
        skills: [
          { name: "code-review", description: "代码审查 — 自动检查代码质量、安全漏洞、最佳实践" },
          { name: "git-workflow", description: "Git 工作流 — 分支管理、commit 规范、PR 自动化" },
          { name: "debugging", description: "调试助手 — 错误分析、日志解读、修复建议" },
        ],
      },
      {
        id: "data",
        name: "数据分析",
        nameEn: "Data & Analytics",
        skills: [
          { name: "sql-generator", description: "SQL 生成器 — 自然语言转 SQL 查询" },
          { name: "data-cleaning", description: "数据清洗 — 缺失值处理、格式标准化、异常检测" },
          { name: "visualization", description: "数据可视化 — 图表选型、配色建议、交互设计" },
        ],
      },
      {
        id: "writing",
        name: "内容创作",
        nameEn: "Writing & Content",
        skills: [
          { name: "doc-writer", description: "文档写作 — 技术文档、API 文档、用户手册" },
          { name: "translation", description: "翻译助手 — 多语言翻译、术语一致性检查" },
          { name: "summarizer", description: "摘要生成 — 长文档/会议记录自动摘要" },
        ],
      },
      {
        id: "ops",
        name: "运维部署",
        nameEn: "DevOps & Infrastructure",
        skills: [
          { name: "docker-compose", description: "Docker 编排 — 容器配置、网络设置、卷管理" },
          { name: "monitoring", description: "监控告警 — 指标分析、日志聚合、告警规则" },
          { name: "ci-cd", description: "CI/CD 流水线 — GitHub Actions、Jenkins、部署自动化" },
        ],
      },
      {
        id: "alibaba",
        name: "阿里生态",
        nameEn: "Alibaba Ecosystem",
        skills: [
          { name: "tongyi-qwen-coding", description: "通义千问代码助手 — 基于 Qwen 的代码生成与审查" },
          { name: "dashscope-rag", description: "DashScope RAG — 文档解析 + 向量检索 + 智能问答" },
          { name: "dingtalk-bot", description: "钉钉机器人 — 群消息推送、工作通知、审批集成" },
          { name: "quickbi-smartq", description: "Quick BI 智能问数 — 自然语言查询 + 可视化图表" },
        ],
      },
    ];

    return NextResponse.json({
      popular: popularLocal,
      trending,
      categories,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch popular skills:", error);
    // Fallback: return categories even if DB query fails
    return NextResponse.json({
      popular: [],
      trending: [],
      categories: [
        {
          id: "alibaba",
          name: "阿里生态",
          nameEn: "Alibaba Ecosystem",
          skills: [
            { name: "tongyi-qwen-coding", description: "通义千问代码助手" },
            { name: "dashscope-rag", description: "DashScope RAG 知识检索" },
            { name: "dingtalk-bot", description: "钉钉机器人 Agent" },
          ],
        },
      ],
      updatedAt: new Date().toISOString(),
    });
  }
}
