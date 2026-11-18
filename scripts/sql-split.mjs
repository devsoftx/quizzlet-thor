// Splits a migration file into single statements for drivers that run one
// statement per call. Semicolons inside '…' strings, "…" identifiers,
// $tag$…$tag$ bodies (functions) and comments don't end a statement.

/** @param {string} sql */
export function splitSql(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  const take = (end) => {
    current += sql.slice(i, end);
    i = end;
  };
  /** The index just past the closing `quote`, or the end of the text. */
  const closing = (quote, from) => {
    const at = sql.indexOf(quote, from);
    return at === -1 ? sql.length : at + quote.length;
  };

  const dollarTag = /\$[A-Za-z_]*\$/y;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end; // drop the comment, keep the line break
    } else if (sql.startsWith("/*", i)) {
      i = closing("*/", i + 2);
    } else if (sql[i] === "'" || sql[i] === '"') {
      // A doubled quote ('' or "") is an escaped quote: closing() lands between the two and the loop takes the next one.
      take(closing(sql[i], i + 1));
    } else if (sql[i] === "$") {
      dollarTag.lastIndex = i;
      const tag = dollarTag.exec(sql)?.[0];
      if (tag) take(closing(tag, i + tag.length));
      else take(i + 1);
    } else if (sql[i] === ";") {
      statements.push(current.trim());
      current = "";
      i++;
    } else {
      take(i + 1);
    }
  }
  statements.push(current.trim());
  return statements.filter(Boolean);
}
