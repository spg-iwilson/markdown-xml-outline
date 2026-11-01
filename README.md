# Markdown XML Outline

Shows Markdown headings and XML elements together in the standard VS Code document Outline.

## Features

- ATX and Setext Markdown headings
- XML elements and namespaces
- Only includes XML opening tags at the start of a line, ignoring indentation; matching closing tags can appear inline
- XML label attributes
- Nested Outline symbols
- Markdown headings inside XML elements stay within that element; heading levels nest within the same XML scope
- Ignores XML-like content in fenced code blocks
- Configurable inclusion/exclusion of XML tags

## Development

Run `npm test` to compile the extension and run the document outline regression tests.

## Settings

- `markdownXmlOutline.xmlTags`: tags to include; empty includes all
- `markdownXmlOutline.excludeXmlTags`: tags to exclude
- `markdownXmlOutline.labelAttributes`: attributes used for symbol detail
- `markdownXmlOutline.includeSelfClosingTags`: include self-closing elements
- `markdownXmlOutline.showXmlAttributes`: show matching attribute in detail
