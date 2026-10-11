import { readFileSync } from 'node:fs';

export const siteCSS = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
// The avatar is inlined, so the rail renders the same from dist/, from _site/, and from an --inline build.
const author = `<a class="author" href="https://github.com/kairevicius"><img src="data:image/jpeg;base64,${readFileSync(new URL('./avatar.jpg', import.meta.url)).toString('base64')}" alt="" width="28" height="28">Paulius Kairevicius</a>`;

export function navigation(page, prefix) {
    const links = [
        ['home', 'Skills', ''],
        ['optical-balance', 'Optical balance', 'optical-balance/'],
        ['write-up', 'Write-up', 'optical-balance/write-up.html'],
        ['demo', 'Demo', 'optical-balance/demo.html'],
        ['proof', 'Proof', 'proof/'],
    ];
    return `<nav class="site-nav" aria-label="Site">${links.map(([id, text, path]) => `<a href="${prefix}${path}"${id === page ? ' aria-current="page"' : ''}>${text}</a>`).join('')}</nav>`;
}

export function sitePage(html, page) {
    const prefix = page === 'home' ? './' : '../';
    const sections = [];
    html = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_, attrs, text) => {
        const title = text.replace(/<[^>]*>/g, '');
        const id = attrs.match(/id="([^"]+)"/)?.[1] ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
        sections.push({ id, title });
        return `<h2${attrs.includes('id=') ? attrs : `${attrs} id="${id}"`}>${text}</h2>`;
    });
    const nav = navigation(page, prefix);
    const rail = `<aside class="site-rail">${author}${nav}<nav class="site-toc" aria-label="On this page">${sections.map(({ id, title }) => `<a href="#${id}">${title}</a>`).join('')}</nav><a href="https://github.com/kairevicius/skills">GitHub ↗</a></aside>`;
    html = html.replace(/<pre(\s[^>]*)?>/g, '<pre$1 tabindex="0">').replace(/<div class="scroll">/g, '<div class="scroll" tabindex="0">');
    return html.replace('</head>', `<style>${siteCSS}</style></head>`)
        .replace('<body>', `<body><a class="skip-link" href="#content">Skip to content</a><div class="site-page">${rail}<div class="site-column">${nav}`)
        .replace('<main>', '<main id="content" tabindex="-1">')
        .replace('</body>', '</div></div></body>');
}

export function demoPage(html) {
    return html.replace('</head>', `<style>${siteCSS}
body { overflow: auto; }
.demo-top { padding: 12px 24px; border-bottom: 1px solid var(--hair); }
.demo-top .site-nav { max-width: 1040px; margin: 0 auto; }
.app { height: calc(100dvh - 69px); min-height: 700px; max-width: 1120px; margin: 0 auto; }
.panel { border: 0; background: #fff; border-radius: 14px; margin: 24px 20px 24px 0; box-shadow: var(--card-shadow); }
.canvas { background: var(--paper); }
.canvas-title { font-weight: 400; }
.canvas-hint { max-width: calc(100% - 40px); font-size: 12px; }
.segmented, .group { border-radius: 9px; }
.segmented button, .group button, .row button { min-height: 44px; }
@media (max-width:760px) { .app { height: auto; min-height: 0; grid-template-rows: 360px auto; } .panel { margin: 0 20px 24px; max-height: none; border: 0; } }
</style></head>`).replace('<body>', `<body><a class="skip-link" href="#content">Skip to content</a><header class="demo-top">${navigation('demo', '../')}</header>`)
        .replace('<div class="app">', '<main class="app" id="content" tabindex="-1">')
        .replace('</aside>\n</div>', '</aside>\n</main>');
}
