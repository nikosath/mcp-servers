import fs from 'fs/promises';
import path from 'path';

/**
 * Get candidate encodings in order of preference from multiple sources:
 * 1. MCP_CANDIDATE_ENCODINGS environment variable (comma-separated)
 * 2. .vscode/settings.json with key "files.candidateGuessEncodings"
 * 3. .mcp-server.json with key "files.candidateGuessEncodings"
 * 4. Default: ["utf-8", "windows1253"]
 */
export async function getCandidateEncodings(workingDir: string = process.cwd()): Promise<string[]> {
  // 1. Check environment variable
  const envCandidates = process.env.MCP_CANDIDATE_ENCODINGS;
  if (envCandidates) {
    const candidates = envCandidates.split(',').map(s => s.trim()).filter(Boolean);
    if (candidates.length > 0) {
      return candidates;
    }
  }

  // 2. Check .vscode/settings.json
  const vscodeSettingsPath = path.join(workingDir, '.vscode', 'settings.json');
  try {
    const vscodeContent = await fs.readFile(vscodeSettingsPath, 'utf-8');
    const vscodeSettings = JSON.parse(vscodeContent);
    const vscodeValue = vscodeSettings['files.candidateGuessEncodings'];
    
    if (vscodeValue) {
      // Handle both array and comma-separated string formats
      let candidates: string[];
      if (Array.isArray(vscodeValue)) {
        candidates = vscodeValue.map(s => String(s).trim()).filter(Boolean);
      } else if (typeof vscodeValue === 'string') {
        candidates = vscodeValue.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        candidates = [];
      }
      
      if (candidates.length > 0) {
        return candidates;
      }
    }
  } catch (error) {
    // File doesn't exist or is malformed, continue to next source
  }

  // 3. Check .mcp-server.json
  const mcpConfigPath = path.join(workingDir, '.mcp-server.json');
  try {
    const mcpContent = await fs.readFile(mcpConfigPath, 'utf-8');
    const mcpSettings = JSON.parse(mcpContent);
    const mcpValue = mcpSettings['files.candidateGuessEncodings'];
    
    if (mcpValue) {
      // Handle both array and comma-separated string formats
      let candidates: string[];
      if (Array.isArray(mcpValue)) {
        candidates = mcpValue.map(s => String(s).trim()).filter(Boolean);
      } else if (typeof mcpValue === 'string') {
        candidates = mcpValue.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        candidates = [];
      }
      
      if (candidates.length > 0) {
        return candidates;
      }
    }
  } catch (error) {
    // File doesn't exist or is malformed, continue to default
  }

  // 4. Default fallback
  return ['utf-8', 'windows1253'];
}
