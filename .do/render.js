import { readFileSync } from "node:fs";
import { argv, env, stdout } from "node:process";

if (!argv[2]) throw new Error("usage: node --env-file=.env.base.local render.js app.yaml");

let inIf = false;
let inElse = false;
let condition = false;
const lines = /** @type {string[]} */ ([]);

for (const line of readFileSync(argv[2], "utf8").split(/\r?\n/)) {
  const ifMatch = line.match(/^\s*#\s*@if\s+\$\{\{\s*(.*?)\s*}}\s*$/);
  if (ifMatch) {
    if (inIf) throw new Error("unsupported nested @if");
    inIf = true;
    inElse = false;

    const expr = ifMatch[1].trim();

    let match = expr.match(/^!\s*env\.(\w+)\s*$/);
    if (match) {
      condition = !env[match[1]];
      continue;
    }

    match = expr.match(/^env\.(\w+)\s*$/);
    if (match) {
      condition = !!env[match[1]];
      continue;
    }

    match = expr.match(/^env\.(\w+)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)')\s*$/);
    if (match) {
      const got = env[match[1]] ?? "";
      const want = match[3] ?? match[4] ?? "";
      condition = match[2] === "==" ? got === want : got !== want;
      continue;
    }

    throw new Error(`unsupported @if expression: ${expr}`);
  }

  if (/^\s*#\s*@else\s*$/.test(line)) {
    if (!inIf) throw new Error("@else without matching @if");
    if (inElse) throw new Error("multiple @else in the same block");
    inElse = true;
    continue;
  }

  if (/^\s*#\s*@endif\s*$/.test(line)) {
    if (!inIf) throw new Error("@endif without matching @if");
    inIf = false;
    inElse = false;
    condition = false;
    continue;
  }

  if (/^\s*#/.test(line)) continue;

  const cleaned = line.replace(/\s+#.*$/, "");
  if (!inIf) lines.push(cleaned);
  else if (inElse ? !condition : condition) lines.push(cleaned);
}

if (inIf) throw new Error("unclosed @if block");

stdout.write(
  lines.join("\n").replace(/\$\{\{\s*(.*?)\s*}}/g, (_, expr) => {
    const envRegex = /^env\.(\w+)\s*$/;
    /** @param {string} value */
    const _eval = (value, required = true) => {
      let match = value.match(envRegex);
      if (match) {
        if (required && !env[match[1]]) throw new Error(`missing env: ${match[1]}`);
        return env[match[1]] ?? "";
      }
      match = value.match(/^("([^"]*)"|'([^']*)')\s*$/);
      return match ? (match[2] ?? match[3] ?? "") : value;
    };

    const ternary = expr.match(/^(.*?)\s*\?\s*(.*?)\s*:\s*(.*)$/);
    if (ternary) {
      let match = ternary[1].match(/^!\s*env\.(\w+)\s*$/);
      const cond = match
        ? !env[match[1]]
        : (match = ternary[1].match(/^env\.(\w+)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)')\s*$/))
          ? match[2] === "=="
            ? (env[match[1]] ?? "") === (match[3] ?? match[4] ?? "")
            : (env[match[1]] ?? "") !== (match[3] ?? match[4] ?? "")
          : (match = ternary[1].match(envRegex))
            ? !!env[match[1]]
            : false;
      return cond ? _eval(ternary[2]) : _eval(ternary[3]);
    }
    const fallback = expr.match(/^(.*?)\s*\|\|\s*(.*)$/);
    if (fallback) {
      const left = _eval(fallback[1], false);
      if (left) return left;
      return _eval(fallback[2]);
    }
    const envMatch = expr.match(envRegex);
    if (envMatch) {
      const value = env[envMatch[1]];
      if (!value) throw new Error(`missing env: ${envMatch[1]}`);
      return value;
    }
    throw new Error(`unsupported expression: ${expr}`);
  }),
);
