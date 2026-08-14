# Rule: Subpath Reverse Proxy & Relative Base Resolution Guidelines

## Problem Summary
When a static frontend application (HTML, JS, JSON) is deployed under a subpath behind a reverse proxy (e.g. Next.js rewriting `/sarmiento-360` to a static Vercel/GitHub Pages deployment):
1. Browsers accessing the subpath without a trailing slash (e.g., `https://domain.com/sarmiento-360`) evaluate static `<base href="./">` tags and relative asset paths (`<script src="dashboard.js">`) against `https://domain.com/` (the domain root).
2. This causes script and asset fetches to request `https://domain.com/dashboard.js` (returning a 404 HTML page instead of JS), which triggers Chrome MIME-type check blocking (`Refused to execute script... because its MIME type ('text/html') is not executable`).

## Mandatory Standard Implementation Rules

### 1. Dynamic `<base>` Element Resolution in `<head>`
In all HTML entry points (`index.html`, `unidades.html`, etc.), NEVER use static `<base href="./">`. Always use a dynamic script in `<head>` before any asset tags:

```html
<script>
    (function() {
        let path = window.location.pathname;
        if (!path.endsWith('/') && !path.endsWith('.html')) {
            path += '/';
        }
        let b = document.createElement('base');
        b.href = window.location.origin + path;
        document.head.appendChild(b);
    })();
</script>
```

### 2. Relative Data URL Resolver in JavaScript
In all JS files fetching JSON or dynamic resources, ALWAYS use a relative path helper function:

```javascript
const getRelativeDataUrl = (file) => {
    let path = window.location.pathname;
    if (!path.endsWith("/") && !path.endsWith(".html")) {
        path += "/";
    }
    return new URL(file, window.location.origin + path).href;
};
```

### 3. Trailing Slash HTTP Redirect Rules
In Vercel / Next.js reverse proxy configuration (`vercel.json` and `next.config.ts`), ALWAYS add an explicit HTTP 301 permanent redirect rule from subpaths without trailing slash to subpaths with trailing slash:

```json
"redirects": [
    {
        "source": "/sarmiento-360",
        "destination": "/sarmiento-360/",
        "permanent": true
    }
]
```

### 4. Non-Blocking External API Fetching
NEVER await external third-party APIs (such as INDEC, ENRE, external APIs) on the critical startup path of `DOMContentLoaded` or `init()`. Always fetch them asynchronously with baseline fallback data and an `AbortController` timeout (2.5s) to guarantee the local application renders 100% of the time.
