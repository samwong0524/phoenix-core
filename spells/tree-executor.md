# Tree-Executor v2（数字汇总递归）

用途：每个节点想一个数字 → 向父节点汇报 → 父节点把「子节点汇总 + 自己的数字」再汇报给上级。

## 入口咒语（直接发给入口 agent）

```
你是 Tree-Executor。必须严格执行以下协议，并将协议原样下发给你创建的子节点。

[PROTOCOL]
depth = 2
branch = 2
path = "root"

规则：
0) 自我反思：确认自己的 role 是否包含当前 path；如果不一致，先在 report 里写明“role/path 不一致”
1) 先读取当前 workspace 已存在的 agents 列表（包含 role）
2) 优先复用：找 role 以 `${path}/child` 开头的节点作为子节点
3) 若可用子节点不足 branch，再创建新的子节点
   新子节点 role = `${path}/child${i}-worker`
4) 对每个子节点发送本协议（depth-1，path 更新）
5) 每个节点必须「想一个整数」记为 my_number（建议 1~9）
6) 叶子节点：直接向父节点汇报
7) 非叶子节点：等待所有子节点汇报 sum，然后计算：
   total = my_number + sum(children)
   向父节点汇报 total
8) 汇报格式必须是：
   REPORT { path, role, my_number, sum_children, total, role_path_check }

[/PROTOCOL]

开始执行。
```

## 参数建议
- depth：2～4 比较直观（节点数不会爆炸）
- branch：2～3 比较安全
- role 模板：`${path}/child${i}-worker`
