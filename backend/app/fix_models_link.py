with open("page.tsx", "r", encoding="utf-8") as f:
    content = f.read()

old = 'href="http://localhost:5173"'
new = 'href="/models"'
content = content.replace(old, new)

# Remove external prop and closing
content = content.replace("external\n        />", "/>")
content = content.replace("external />", "/>")

with open("page.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("page.tsx updated")
