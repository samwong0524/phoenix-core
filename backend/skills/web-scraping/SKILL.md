---
name: web-scraping
description: Use Scrapling for web scraping — HTTP fetching, browser automation, adaptive parsing, and async crawling.
auto-load: false
roles: [researcher, creator, specialist]
requires: []
---

# Web Scraping with Scrapling

Scrapling is a Python adaptive web scraping framework. It can fetch pages, parse HTML, and survive website redesigns by auto-relocating elements.

## Prerequisites

Install Scrapling and dependencies before use:

```bash
pip install scrapling
# For dynamic page scraping (browser automation):
playwright install chromium
```

## Quick Start

### Fetch a single page

```python
from scrapling import Fetcher

fetcher = Fetcher()
page = fetcher.get("https://example.com")
page.save("page.html")

# Extract with CSS
title = page.css_first("h1", "text")
links = page.css("a[href]")
for link in links:
    print(link.attrs["href"])
```

### Adaptive parsing (survive website changes)

```python
from scrapling import Fetcher

fetcher = Fetcher()
page = fetcher.get("https://example.com/products")

# First run: auto-save element signatures
if page.adaptive is None:
    elements = page.css(".product-title")
    page.adaptive = elements

# Subsequent runs: if the page changes, Scrapling auto-relocates
adaptive_elements = page.adaptive_elements
for elem in adaptive_elements:
    print(elem.text())
```

When the page structure changes, `adaptive_elements` will still find the same data by similarity matching.

### Dynamic pages (JavaScript rendering)

```python
from scrapling import DynamicFetcher

fetcher = DynamicFetcher(headless=True)
page = fetcher.get("https://example.com/spa-page")

# Wait for JS to render
page.wait_for_selector(".data-loaded")
items = page.css(".item-card")
```

### Stealthy mode (anti-bot bypass)

```python
from scrapling import StealthyFetcher

fetcher = StealthyFetcher()
page = fetcher.get("https://example.com/protected")
# Uses TLS fingerprinting, stealth browser automation
```

## Advanced Usage

### Async Spider

```python
from scrapling import BaseSpider, Runner

class MySpider(BaseSpider):
    name = "myspider"
    start_urls = ["https://example.com/page1", "https://example.com/page2"]
    concurrency = 5  # concurrent requests

    def parse(self, page):
        title = page.css_first("h1", "text")
        links = page.css("a[href]", lambda a: a.attrs["href"])
        yield {"title": title, "links": links}

runner = Runner()
runner.run(MySpider)
```

### Streaming (long crawls with real-time stats)

```python
async for item in spider.stream():
    print(f"Got: {item}")
    print(f"Stats: {spider.stats}")
```

### Session persistence

```python
from scrapling import Fetcher

fetcher = Fetcher()
# First request — login
page = fetcher.post("https://example.com/login", data={"user": "me", "pass": "secret"})
# Second request — cookies and state persist
profile = fetcher.get("https://example.com/profile")
```

### Development mode (cache responses)

```python
from scrapling import Fetcher

fetcher = Fetcher(cache_to="cache/")
page = fetcher.get("https://example.com")
# Subsequent runs read from cache — no network requests
```

## Key Patterns

### Extract text with XPath

```python
page.xpath("//div[@class='content']/p/text()")
page.xpath_first("//span[@id='price']/text()")
```

### Extract attributes

```python
page.css("img", lambda img: img.attrs["src"])
page.css_first("a", lambda a: a.attrs["href"])
```

### Iterate through pagination

```python
next_page = page.css_first("a.next", lambda a: a.attrs["href"])
while next_page:
    page = fetcher.get(next_page)
    # process page
    next_page = page.css_first("a.next", lambda a: a.attrs["href"])
```

### Block trackers (built in)

```python
from scrapling import Fetcher
# ~3500 ad/tracker domains blocked by default
fetcher = Fetcher(block_ads=True)
```

### Proxy rotation

```python
fetcher = Fetcher(proxy="http://user:pass@proxy:8080")
# Or cyclic rotation
fetcher = Fetcher(proxy=["http://proxy1:8080", "http://proxy2:8080"])
```

## When to use which Fetcher

| Fetcher | Speed | Use case |
|---------|-------|----------|
| `Fetcher` | Fast | Static HTML, APIs |
| `DynamicFetcher` | Medium | JS-rendered SPAs, pages requiring interaction |
| `StealthyFetcher` | Slow | Anti-bot protected pages (Cloudflare, etc.) |

## Common pitfalls

- Use `page.css_first()` when you expect one element, `page.css()` for multiple
- `page.save("file.html")` to debug what the page looks like after fetch
- Adaptive parsing requires at least one successful extraction before it can auto-relocate
- DynamicFetcher requires Playwright Chromium to be installed (`playwright install chromium`)
