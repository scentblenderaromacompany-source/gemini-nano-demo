// Bridge-compatible Skill Registry
// ESM module for the bridge to access skill definitions

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedSkills = null;

function loadSkills() {
  if (cachedSkills) return cachedSkills;
  
  const registryPath = path.join(__dirname, '../extension/skills/registry.js');
  const content = fs.readFileSync(registryPath, 'utf-8');
  
  // Extract SKILLS array from the file - handle both const/let/var
  const match = content.match(/(?:const|let|var)\s+SKILLS\s*=\s*(\[[\s\S]*?\]);/);
  if (match) {
    try {
      cachedSkills = eval(`(${match[1]})`);
    } catch (e) {
      console.error('[SkillRegistry] Failed to parse skills:', e.message);
      cachedSkills = [];
    }
  }
  
  return cachedSkills || [];
}

export function getSkill(id) {
  return loadSkills().find(s => s.id === id);
}

export function getAllSkills() {
  return loadSkills();
}