// Migrate base64 avatars from agents.json to public/avatars/ files
// Run: node scripts/migrate_avatars.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const AGENTS_PATH = path.join(__dirname, '..', 'agents.json');
const AVATAR_DIR = path.join(__dirname, '..', 'public', 'avatars');

async function main() {
  const raw = fs.readFileSync(AGENTS_PATH, 'utf-8');
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  const data = JSON.parse(clean);
  let changed = false;

  for (const agent of data.agents) {
    const avatar = agent.avatar || '';
    // Only migrate base64 data URIs
    if (avatar.indexOf('data:') !== 0) continue;

    console.log('Migrating avatar for:', agent.id, '(' + (avatar.length / 1024).toFixed(0) + 'KB)');

    const ext = 'jpg';
    const filename = agent.id + '.' + ext;
    const outputPath = path.join(AVATAR_DIR, filename);

    // Decode base64 (strip data:...;base64, prefix)
    const commaIdx = avatar.indexOf(',');
    const base64Data = avatar.substring(commaIdx + 1);
    const imgBuffer = Buffer.from(base64Data, 'base64');

    // Compress & resize with sharp
    await sharp(imgBuffer)
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(outputPath);

    const fileSize = fs.statSync(outputPath).size;
    console.log('  -> Saved', filename, '(' + (fileSize / 1024).toFixed(0) + 'KB)');

    // Update agent avatar to file path
    agent.avatar = '/avatars/' + filename;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(AGENTS_PATH, JSON.stringify(data, null, 2), 'utf-8');
    console.log('agents.json updated with file paths.');
  } else {
    console.log('No base64 avatars to migrate.');
  }
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1); });
