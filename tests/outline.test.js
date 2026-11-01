const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(start, end) { this.start = start; this.end = end; }
}
class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    Object.assign(this, { name, detail, kind, range, selectionRange, children: [] });
  }
}

function outline(text, settings = {}) {
  let provider;
  const vscode = {
    Position, Range, DocumentSymbol,
    SymbolKind: { Namespace: 1, Module: 2, Class: 3, Method: 4, Field: 5, String: 6, Property: 7, Object: 8 },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
    languages: { registerDocumentSymbolProvider: (_selector, value) => { provider = value; return { dispose() {} }; } }
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "out", "extension.js"), "utf8"), {
    exports,
    require: name => {
      assert.equal(name, "vscode");
      return vscode;
    }
  });
  exports.activate({ subscriptions: [] });
  const lines = text.split(/\r\n|\r|\n/);
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  const positionAt = offset => {
    let line = starts.length - 1;
    while (starts[line] > offset) line--;
    return new Position(line, offset - starts[line]);
  };
  const document = {
    uri: {},
    lineCount: lines.length,
    getText: () => text,
    offsetAt: position => starts[position.line] + position.character,
    positionAt,
    lineAt: i => ({
      text: lines[i],
      range: new Range(new Position(i, 0), new Position(i, lines[i].length)),
      rangeIncludingLineBreak: new Range(new Position(i, 0), positionAt(starts[i + 1] ?? text.length))
    })
  };
  return provider.provideDocumentSymbols(document, { isCancellationRequested: false });
}

function shape(symbols) {
  return Array.from(symbols, symbol => ({ name: symbol.name, children: shape(symbol.children) }));
}

function entries(symbols, parent) {
  return Array.from(symbols).flatMap(symbol => [
    { symbol, parent },
    ...entries(symbol.children, symbol)
  ]);
}

test("headings cannot extend beyond their containing XML element", () => {
  assert.deepEqual(shape(outline("<tools>\n### Tool\n</tools>\n<message>\n# Tone\n</message>\nTrailing text")), [
    { name: "tools", children: [{ name: "Tool", children: [] }] },
    { name: "message", children: [{ name: "Tone", children: [] }] }
  ]);
});

test("nested XML headings do not terminate headings in the outer scope", () => {
  assert.deepEqual(shape(outline("# Outer\n<tools>\n# Inner\n</tools>\n## After tools\n# Next")), [
    { name: "Outer", children: [
      { name: "tools", children: [{ name: "Inner", children: [] }] },
      { name: "After tools", children: [] }
    ] },
    { name: "Next", children: [] }
  ]);
});

test("heading levels nest only within the same XML scope", () => {
  assert.deepEqual(shape(outline("<message>\n# First\n## Child\n# Second\n</message>\n<message>\n## Separate\n</message>\nTrailing text")), [
    { name: "message", children: [
      { name: "First", children: [{ name: "Child", children: [] }] },
      { name: "Second", children: [] }
    ] },
    { name: "message", children: [{ name: "Separate", children: [] }] }
  ]);
});

test("Setext headings also stay inside XML boundaries", () => {
  assert.deepEqual(shape(outline("<parent>\nHeading\n=======\nChild\n-----\n</parent>\nTrailing text")), [
    { name: "parent", children: [{ name: "Heading", children: [{ name: "Child", children: [] }] }] }
  ]);
});



test("inline closing tags keep a line-start child inside its parent", () => {
  assert.deepEqual(shape(outline("<assistant-text>\n<session-title>Actual</session-title>\n</assistant-text>\nTrailing text")), [
    { name: "assistant-text", children: [{ name: "session-title", children: [] }] }
  ]);
});

test("a closing tag on its own line already nests correctly", () => {
  assert.deepEqual(shape(outline("<assistant-text>\n<session-title>Actual\n</session-title>\n</assistant-text>")), [
    { name: "assistant-text", children: [{ name: "session-title", children: [] }] }
  ]);
});

test("inline closing tags end ranges and leave following elements as siblings", () => {
  const text = "<parent>\r\n  <child>One</child>\r\n  <child>Two</child>\r\n</parent>\r\n<next />";
  const symbols = outline(text);
  assert.deepEqual(shape(symbols), [
    { name: "parent", children: [{ name: "child", children: [] }, { name: "child", children: [] }] },
    { name: "next", children: [] }
  ]);
  assert.equal(symbols[0].children[0].range.end.line, 1);
  assert.equal(symbols[0].children[0].range.end.character, "  <child>One</child>".length);
});

test("inline opening tags are still ignored", () => {
  assert.deepEqual(shape(outline("<parent>\nText <inline>Example</inline>\n</parent>")), [
    { name: "parent", children: [] }
  ]);
});

test("fenced closing tags do not close an open element", () => {
  assert.deepEqual(shape(outline("<parent>\n```\nText </parent>\n<ignored />\n```\n<child />\n</parent>\n<next />")), [
    { name: "parent", children: [{ name: "child", children: [] }] },
    { name: "next", children: [] }
  ]);
});

test("tag filtering, labels and self-closing settings are preserved", () => {
  const text = "<parent>\n<hidden>\n<child name=\"Label\">Text</child>\n<empty />\n</hidden>\n</parent>\n<next />";
  const symbols = outline(text, { excludeXmlTags: ["hidden"], includeSelfClosingTags: false });
  assert.deepEqual(shape(symbols), [
    { name: "parent", children: [{ name: "child", children: [] }] }
  ]);
  assert.equal(symbols[0].children[0].detail, 'name="Label"');
  assert.deepEqual(shape(outline(text, { xmlTags: ["child"] })), [{ name: "child", children: [] }]);
});

test("Markdown headings and XML still share an outline", () => {
  assert.deepEqual(shape(outline("# Heading\n<parent>\n<child>Text</child>\n</parent>\n# Next")), [
    { name: "Heading", children: [{ name: "parent", children: [{ name: "child", children: [] }] }] },
    { name: "Next", children: [] }
  ]);
});
