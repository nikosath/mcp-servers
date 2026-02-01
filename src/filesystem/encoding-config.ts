import fs from 'fs/promises';
import path from 'path';

/**
 * Get candidate encodings from environment variable, VS Code settings, or defaults.
 * Priority order:
 * 1. MCP_CANDIDATE_ENCODINGS environment variable (comma-separated list)
 * 2. .vscode/settings.json "files.candidateEncodings" setting
 * 3. Default: ["utf-8", "windows1253"]
 */
export async function getCandidateEncodings(): Promise<string[]> {
  // Check environment variable first
  const envEncodings = process.env.MCP_CANDIDATE_ENCODINGS;
  if (envEncodings) {
    return envEncodings.split(',').map(e => e.trim()).filter(e => e.length > 0);
  }

  // Check VS Code settings
  try {
    const vscodePath = path.join(process.cwd(), '.vscode', 'settings.json');
    const settingsContent = await fs.readFile(vscodePath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    
    if (settings['files.candidateEncodings']) {
      const candidateEncodings = settings['files.candidateEncodings'];
      
      // Handle both array and comma-separated string formats
      if (Array.isArray(candidateEncodings)) {
        return candidateEncodings.map(e => String(e).trim()).filter(e => e.length > 0);
      } else if (typeof candidateEncodings === 'string') {
        return candidateEncodings.split(',').map(e => e.trim()).filter(e => e.length > 0);
      }
    }
  } catch (error) {
    // If .vscode/settings.json doesn't exist or can't be parsed, continue to defaults
  }

  // Return defaults
  return ['utf-8', 'windows1253'];
}
