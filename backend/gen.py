import json
plan = {"title": "AI Agent System Plan 2026"}
with open("design_plan_2026.json","w",encoding="utf-8") as f:
    json.dump(plan,f,ensure_ascii=False,indent=2)
print("ok")
