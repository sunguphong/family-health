// 빌드한 dist 폴더를 gh-pages 브랜치로 올려 GitHub Pages에 배포한다.  사용: npm run deploy
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });
const remote = execSync('git remote get-url origin').toString().trim();

run('npm run build');
rmSync('dist/.git', { recursive: true, force: true });
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run(`git commit -q -m "deploy ${new Date().toISOString()}"`, 'dist');
run(`git push -f "${remote}" gh-pages`, 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log('\n배포 완료. 1~2분 뒤 GitHub Pages 주소에 반영됩니다.');
