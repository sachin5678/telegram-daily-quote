/**
 * List the GitHub Actions secret NAMES of a repository (names only, never
 * values) and print the PAT-free result.
 *
 *   node scripts/gh-secrets.mjs [owner/repo]
 */
import { execFileSync } from 'node:child_process';

const repo = process.argv[2] ?? 'sachin5678/telegram-daily-quote';
const pat = execFileSync('git', ['credential-manager', 'get'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
})
  .split('\n')
  .map((l) => l.trim())
  .find((l) => l.startsWith('password='))
  ?.slice('password='.length);

if (!pat) {
  console.error('no credential found in the git credential manager');
  process.exit(2);
}

const res = await fetch(`https://api.github.com/repos/${repo}/actions/secrets?per_page=100`, {
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${pat}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'quote-card-tool',
  },
});

if (!res.ok) {
  console.error(`github api -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}

const j = await res.json();
console.log(`secrets in ${repo}:`);
for (const s of j.secrets ?? []) console.log(` - ${s.name} (updated ${s.updated_at})`);
