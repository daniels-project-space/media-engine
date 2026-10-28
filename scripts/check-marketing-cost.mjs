import fs from "node:fs";
import ts from "typescript";

// This existing app has legacy full-table readers. Enforce the new marketing
// boundary without hiding those findings behind invented scan exceptions.
const files = fs
  .readdirSync("convex")
  .filter((name) => /^marketing.*\.ts$/.test(name));
const failures = [];
let reads = 0;
for (const name of files) {
  const file = `convex/${name}`,
    source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "query" &&
      /\.db$/.test(node.expression.expression.getText(tree))
    ) {
      reads++;
      let chain = node;
      while (
        chain.parent &&
        (ts.isPropertyAccessExpression(chain.parent) ||
          ts.isCallExpression(chain.parent))
      )
        chain = chain.parent;
      const body = chain.getText(tree);
      if (
        !/\.withIndex\(/.test(body) ||
        !/\.(take|unique|paginate|first)\(/.test(body) ||
        /\.collect\(/.test(body)
      ) {
        failures.push(
          `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: marketing reads must use an index and an explicit result bound`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
if (fs.existsSync("vercel.json")) {
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  if (config.crons?.some((cron) => cron.schedule === "* * * * *"))
    failures.push("Do not introduce a second minute scheduler on Vercel");
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Marketing cost source checks passed: ${reads} indexed, bounded reads across ${files.length} modules. Provider bills, retries and R2 receipts require separate qualification.`,
  );
