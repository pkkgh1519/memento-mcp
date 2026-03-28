export default async function cleanup(args) {
  /** cleanup-noise.js reads process.argv.slice(2) directly */
  const savedArgv = process.argv;
  try {
    process.argv = ["node", "cleanup-noise.js", ...buildFlags(args)];
    await import("../../scripts/cleanup-noise.js");
  } finally {
    process.argv = savedArgv;
  }
}

function buildFlags(args) {
  const flags = [];
  if (args.execute)    flags.push("--execute");
  if (args.includeNli) flags.push("--include-nli");
  return flags;
}
