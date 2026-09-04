#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL("./BOOK-DRAFT.md", import.meta.url);
const outputPath = new URL("./story-body.generated.tex", import.meta.url);

const texEscapes = new Map([
  ["\\", "\\textbackslash{}"],
  ["&", "\\&"],
  ["%", "\\%"],
  ["$", "\\$"],
  ["#", "\\#"],
  ["_", "\\_"],
  ["{", "\\{"],
  ["}", "\\}"],
  ["~", "\\textasciitilde{}"],
  ["^", "\\textasciicircum{}"],
]);

function escapeTex(text) {
  return text.replace(/[\\&%$#_{}~^]/gu, (character) => texEscapes.get(character));
}

function convertInline(text) {
  let opens = true;
  const quoted = text.replaceAll('"', () => {
    const mark = opens ? "``" : "''";
    opens = !opens;
    return mark;
  });
  if (!opens) throw new Error(`Unbalanced quotation mark in: ${text}`);

  return quoted
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/u)
    .map((token) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return `\\textbf{${escapeTex(token.slice(2, -2))}}`;
      }
      if (token.startsWith("*") && token.endsWith("*")) {
        return `\\emph{${escapeTex(token.slice(1, -1))}}`;
      }
      return escapeTex(token);
    })
    .join("");
}

function convert(markdown) {
  const blocks = markdown.replaceAll("\r\n", "\n").trim().split(/\n{2,}/u);
  if (blocks.shift()?.trim() !== "# The Book of Conditions") {
    throw new Error("The manuscript must begin with '# The Book of Conditions'.");
  }
  if (blocks[0]?.startsWith("Complete first-construction manuscript,")) blocks.shift();

  const sections = blocks.filter((block) => block.startsWith("## ")).length;
  if (sections !== 12) throw new Error(`Expected 12 sections; found ${sections}.`);

  const output = [];
  let openingParagraph = false;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index].trim();
    if (block.startsWith("## ")) {
      output.push(`\\storysection{${convertInline(block.slice(3).trim())}}`);
      openingParagraph = true;
      continue;
    }
    if (block === "* * *") {
      if (!blocks[index + 1]?.startsWith("## ")) output.push("\\storybreak");
      openingParagraph = false;
      continue;
    }
    if (block.startsWith("#")) throw new Error(`Unsupported heading: ${block}`);

    const paragraph = block.split("\n").map((line) => line.trim()).join(" ");
    output.push(`${openingParagraph ? "\\storyopening " : ""}${convertInline(paragraph)}\\par`);
    openingParagraph = false;
  }

  return `${output.join("\n\n")}\n`;
}

await writeFile(outputPath, convert(await readFile(sourcePath, "utf8")));
