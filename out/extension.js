"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
function activate(context) {
    const selector = [
        { language: "markdown", scheme: "file", pattern: "**/*.md" },
        { language: "markdown", scheme: "untitled" }
    ];
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, new MarkdownXmlSymbolProvider(), { label: "Markdown XML Outline" }));
}
function deactivate() { }
class MarkdownXmlSymbolProvider {
    provideDocumentSymbols(document, token) {
        if (token.isCancellationRequested)
            return [];
        const settings = readSettings(document.uri);
        const parsed = parseDocument(document, settings, token);
        if (token.isCancellationRequested)
            return [];
        return buildHierarchy(parsed).map(s => convertToDocumentSymbol(document, s));
    }
}
function readSettings(uri) {
    const c = vscode.workspace.getConfiguration("markdownXmlOutline", uri);
    return {
        xmlTags: toSet(c.get("xmlTags", [])),
        excludeXmlTags: toSet(c.get("excludeXmlTags", ["br", "hr", "img", "input", "meta", "link"])),
        labelAttributes: c.get("labelAttributes", ["name", "id", "title", "key", "type"]).map(x => x.toLowerCase()),
        includeSelfClosingTags: c.get("includeSelfClosingTags", true),
        showXmlAttributes: c.get("showXmlAttributes", true)
    };
}
function toSet(values) { return new Set(values.map(v => v.trim().toLowerCase()).filter(Boolean)); }
function parseDocument(document, settings, token) {
    const text = document.getText();
    const fenced = findFencedCodeRanges(document);
    const xml = parseXmlElements(text, settings, fenced, token);
    return [...parseMarkdownHeadings(document, fenced, xml), ...xml];
}
function findFencedCodeRanges(document) {
    const ranges = [];
    let active;
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        if (!active) {
            const m = line.text.match(/^\s{0,3}(`{3,}|~{3,})/);
            if (m)
                active = { ch: m[1][0], len: m[1].length, start: document.offsetAt(new vscode.Position(i, 0)) };
        }
        else {
            const esc = active.ch === "`" ? "`" : "~";
            if (new RegExp(`^\\s{0,3}${esc}{${active.len},}\\s*$`).test(line.text)) {
                ranges.push([active.start, document.offsetAt(line.rangeIncludingLineBreak.end)]);
                active = undefined;
            }
        }
    }
    if (active)
        ranges.push([active.start, document.getText().length]);
    return ranges;
}
function parseMarkdownHeadings(document, excluded, xml) {
    const h = [];
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i), start = document.offsetAt(line.range.start);
        if (inRanges(start, excluded))
            continue;
        const m = line.text.match(/^\s{0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
        if (m) {
            const level = m[1].length, name = m[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
            if (!name)
                continue;
            const marker = line.text.indexOf(m[1]);
            let col = marker + level;
            while (col < line.text.length && /[ \t]/.test(line.text[col]))
                col++;
            h.push({ type: "heading", name, detail: `Heading ${level}`, kind: headingKind(level), startOffset: start, selectionStartOffset: start + col, selectionEndOffset: start + col + name.length, endOffset: document.getText().length, children: [] });
            continue;
        }
        if (i === 0 || !line.text.trim())
            continue;
        const sm = line.text.match(/^\s{0,3}(=+|-+)\s*$/);
        if (!sm)
            continue;
        const prev = document.lineAt(i - 1), ps = document.offsetAt(prev.range.start), name = prev.text.trim();
        if (!name || inRanges(ps, excluded))
            continue;
        const level = sm[1][0] === "=" ? 1 : 2, col = prev.text.indexOf(name);
        h.push({ type: "heading", name, detail: `Heading ${level}`, kind: headingKind(level), startOffset: ps, selectionStartOffset: ps + col, selectionEndOffset: ps + col + name.length, endOffset: document.getText().length, children: [] });
    }
    const scopes = h.map(heading => {
        let parent;
        for (const element of xml) {
            if (element.startOffset <= heading.startOffset && element.endOffset >= heading.selectionEndOffset &&
                (!parent || element.startOffset > parent.startOffset))
                parent = element;
        }
        if (parent)
            heading.endOffset = parent.endOffset;
        return parent;
    });
    for (let i = 0; i < h.length; i++) {
        const level = +(h[i].detail.match(/\d+/)?.[0] ?? 6);
        for (let j = i + 1; j < h.length; j++) {
            if (h[j].startOffset >= h[i].endOffset)
                break;
            if (scopes[j] !== scopes[i])
                continue;
            const next = +(h[j].detail.match(/\d+/)?.[0] ?? 6);
            if (next <= level) {
                h[i].endOffset = h[j].startOffset;
                break;
            }
        }
    }
    return h;
}
function headingKind(n) { return [vscode.SymbolKind.Namespace, vscode.SymbolKind.Module, vscode.SymbolKind.Class, vscode.SymbolKind.Method, vscode.SymbolKind.Field, vscode.SymbolKind.String][n - 1]; }
function parseXmlElements(text, s, excluded, token) {
    const result = [], open = [];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([A-Za-z_][\w:.-]*)(?:\s+[^<>]*?)?\/?>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (token.isCancellationRequested)
            return [];
        const full = m[0], start = m.index, end = start + full.length;
        if (inRanges(start, excluded) || full.startsWith("<!") || full.startsWith("<?"))
            continue;
        const tag = m[1];
        if (!tag)
            continue;
        const norm = tag.toLowerCase(), closing = /^<\//.test(full), self = /\/>\s*$/.test(full);
        if (closing) {
            closeXml(norm, end, open);
            continue;
        }
        if (!isAtLineStart(text, start))
            continue;
        const included = !s.excludeXmlTags.has(norm) && (s.xmlTags.size === 0 || s.xmlTags.has(norm));
        let symbol;
        if (included && (!self || s.includeSelfClosingTags)) {
            const attr = findLabelAttribute(full, s.labelAttributes), sel = start + full.indexOf(tag);
            symbol = { type: "xml", name: tag, detail: s.showXmlAttributes && attr ? `${attr.name}="${attr.value}"` : "XML element", kind: self ? vscode.SymbolKind.Property : vscode.SymbolKind.Object, startOffset: start, selectionStartOffset: sel, selectionEndOffset: sel + tag.length, endOffset: self ? end : text.length, children: [] };
            result.push(symbol);
        }
        if (!self)
            open.push({ tagName: norm, symbol });
    }
    return result;
}
function isAtLineStart(text, offset) {
    const lineStart = Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1), text.lastIndexOf("\u2028", offset - 1), text.lastIndexOf("\u2029", offset - 1)) + 1;
    return /^\s*$/.test(text.slice(lineStart, offset));
}
function closeXml(tag, end, open) {
    for (let i = open.length - 1; i >= 0; i--)
        if (open[i].tagName === tag) {
            if (open[i].symbol)
                open[i].symbol.endOffset = end;
            open.splice(i);
            return;
        }
}
function findLabelAttribute(full, preferred) {
    const attrs = new Map(), re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(full)) !== null)
        attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? "");
    for (const name of preferred)
        if (attrs.has(name))
            return { name, value: attrs.get(name) };
    return undefined;
}
function buildHierarchy(symbols) {
    const sorted = [...symbols].sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset || (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "heading" ? -1 : 1));
    sorted.forEach(s => s.children = []);
    const roots = [], stack = [];
    for (const s of sorted) {
        while (stack.length && !contains(stack[stack.length - 1], s))
            stack.pop();
        if (stack.length)
            stack[stack.length - 1].children.push(s);
        else
            roots.push(s);
        if (s.endOffset > s.startOffset)
            stack.push(s);
    }
    return roots;
}
function contains(p, c) { return p !== c && p.startOffset <= c.startOffset && p.endOffset >= c.endOffset; }
function convertToDocumentSymbol(document, p) {
    const len = document.getText().length, start = clamp(p.startOffset, 0, len), end = clamp(p.endOffset, start, len), ss = clamp(p.selectionStartOffset, start, end), se = clamp(p.selectionEndOffset, ss, end);
    const ds = new vscode.DocumentSymbol(p.name, p.detail, p.kind, new vscode.Range(document.positionAt(start), document.positionAt(end)), new vscode.Range(document.positionAt(ss), document.positionAt(se)));
    ds.children = p.children.map(c => convertToDocumentSymbol(document, c));
    return ds;
}
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
function inRanges(offset, ranges) { return ranges.some(([a, b]) => offset >= a && offset < b); }
//# sourceMappingURL=extension.js.map