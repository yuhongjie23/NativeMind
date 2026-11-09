import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { EN } from '../../../src/ui/i18n/en';

it('provides English translations for Chinese literal t() calls in the UI', () => {
  const missing: string[] = [];
  function walk(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/\.tsx?$/.test(path)) continue;
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
          const key = node.arguments[0];
          if (key && ts.isStringLiteral(key) && /[\u4e00-\u9fff]/.test(key.text) && !EN[key.text]) missing.push(`${path}: ${key.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  walk('src/ui');
  expect(missing).toEqual([]);
});

 it.each(['LearningPanel', 'CompanionPanel', 'LetterPanel'])('%s has no untranslated Chinese JSX labels', panel => {
   const path = 'src/ui/demo/fullscreen-cozy-home/panels/' + panel + '.tsx';
   const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
   const raw: string[] = [];
   const visit = (node: ts.Node): void => {
     if (ts.isJsxText(node) && /[\u3400-\u9fff]/u.test(node.text)) raw.push(node.text.trim());
     if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && /[\u3400-\u9fff]/u.test(node.initializer.text)) raw.push(node.initializer.text);
     ts.forEachChild(node, visit);
   };
   visit(source);
   expect(raw).toEqual([]);
 });
