/**
 * 외부 의존성 없는 CLI 인자 파서.
 * --flag -> { flag: true }
 * --key value -> { key: "value" }
 * positional -> { _: ["pos1", "pos2"] }
 */
export function parseArgs(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key  = args[i].slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        result[key] = true;
      } else {
        result[key] = next;
        i++;
      }
    } else {
      result._.push(args[i]);
    }
  }
  return result;
}
