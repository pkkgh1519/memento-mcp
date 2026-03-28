#!/usr/bin/env node
import { parseArgs } from '../lib/cli/parseArgs.js';

const COMMANDS = {
  serve:     () => import('../lib/cli/serve.js'),
  migrate:   () => import('../lib/cli/migrate.js'),
  cleanup:   () => import('../lib/cli/cleanup.js'),
  backfill:  () => import('../lib/cli/backfill.js'),
  stats:     () => import('../lib/cli/stats.js'),
  health:    () => import('../lib/cli/health.js'),
  recall:    () => import('../lib/cli/recall.js'),
  remember:  () => import('../lib/cli/remember.js'),
  inspect:   () => import('../lib/cli/inspect.js'),
};

function printUsage() {
  const lines = [
    'Usage: memento-mcp <command> [options]',
    '',
    'Commands:',
    '  serve                       Start the MCP server',
    '  migrate                     Run DB migrations',
    '  cleanup [--execute]         Clean noise fragments (default: dry-run)',
    '  backfill                    Backfill missing embeddings',
    '  stats                       Show fragment statistics',
    '  health                      Check DB/Redis/embedding connectivity',
    '  recall <query> [--topic x]  Search fragments from terminal',
    '  remember <content> --topic  Store a fragment from terminal',
    '  inspect <fragment-id>       Show fragment detail + 1-hop links',
    '',
    'Options:',
    '  --help                      Show this help message',
    '  --json                      Output as JSON (where supported)',
  ];
  console.log(lines.join('\n'));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === '--help') {
    printUsage();
    process.exit(0);
  }

  if (!COMMANDS[cmd]) {
    console.error(`Unknown command: ${cmd}`);
    console.error('Run "memento-mcp --help" for usage.');
    process.exit(1);
  }

  const args = parseArgs(rest);

  try {
    const mod = await COMMANDS[cmd]();
    await mod.default(args);
  } catch (err) {
    console.error(`[${cmd}] ${err.message}`);
    if (args.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
